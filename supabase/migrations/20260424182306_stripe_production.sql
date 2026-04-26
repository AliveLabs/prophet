-- Stripe production rollout: tier rename (starter|pro|agency -> entry|mid|top),
-- new billing columns on organizations, webhook idempotency ledger, trial reminder
-- dedupe log. See plan in .cursor/plans/stripe_production_rollout_*.plan.md.

-- 1. Tier enum rename (applied as a text-column CHECK, not a Postgres enum type).
--    Mapping (per Apr 2026 pricing brief):
--      starter -> entry   (was 3 loc / 15 comp; becomes 1 loc / 3 comp -- DOWNGRADE)
--      pro     -> mid     (was 10 loc / 50 comp; becomes 1 loc / 5 comp -- DOWNGRADE)
--      agency  -> top     (was 50 loc / 200 comp; becomes 3 loc / 10 comp -- DOWNGRADE)
--    `free` and `suspended` stay as-is. `suspended` was already referenced by
--    app code (`deactivateOrg`) but the pre-existing CHECK omitted it -- we fix
--    that here so admin suspend actually writes.

alter table public.organizations
  drop constraint if exists organizations_subscription_tier_check;

update public.organizations set subscription_tier = 'entry' where subscription_tier = 'starter';
update public.organizations set subscription_tier = 'mid'   where subscription_tier = 'pro';
update public.organizations set subscription_tier = 'top'   where subscription_tier = 'agency';

alter table public.organizations
  add constraint organizations_subscription_tier_check
  check (subscription_tier in ('free','entry','mid','top','suspended'));

-- 2. New billing columns.
--
--    - stripe_price_id: distinguishes monthly vs annual and brand.
--    - current_period_end: renewal date for UI + grace logic.
--    - cancel_at_period_end: true when user hit "cancel" in Customer Portal.
--    - payment_state: Stripe subscription status mirror. NULL means "no
--      subscription" (free-tier users who never subscribed). Once a
--      subscription exists, this never goes back to NULL.

alter table public.organizations
  add column if not exists stripe_price_id        text,
  add column if not exists current_period_end     timestamptz,
  add column if not exists cancel_at_period_end   boolean not null default false,
  add column if not exists payment_state          text;

alter table public.organizations
  drop constraint if exists organizations_payment_state_check;

alter table public.organizations
  add constraint organizations_payment_state_check
  check (
    payment_state is null
    or payment_state in ('trialing','active','past_due','canceled','incomplete','incomplete_expired','unpaid','paused')
  );

create index if not exists organizations_stripe_customer_id_idx
  on public.organizations (stripe_customer_id);
create index if not exists organizations_payment_state_idx
  on public.organizations (payment_state) where payment_state is not null;

-- 3. Webhook idempotency ledger.
--    Every Stripe webhook handler does an INSERT ... ON CONFLICT DO NOTHING
--    on (event_id). If 0 rows affected, the event was already processed and
--    the handler short-circuits with 200. Prevents double-mirror writes when
--    Stripe retries on transient errors.

create table if not exists public.stripe_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

comment on table public.stripe_webhook_events is
  'Idempotency ledger for POST /api/stripe/webhook. Handler inserts (event_id) with ON CONFLICT DO NOTHING; zero rows = duplicate, skip.';

grant select, insert, update on public.stripe_webhook_events to service_role;

-- 4. Trial reminder dedupe log.
--    The Day 10 / Day 13 Resend reminders are driven by a daily cron that
--    computes (trial_ends_at::date - now()::date). Unique key on
--    (organization_id, reminder_day) prevents double-sends if the cron runs
--    twice or the query returns the same org twice.

create table if not exists public.trial_reminder_sends (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reminder_day    int  not null check (reminder_day in (10, 13)),
  sent_at         timestamptz not null default now(),
  primary key (organization_id, reminder_day)
);

comment on table public.trial_reminder_sends is
  'Dedupe log for /api/cron/trial-reminders. PK = (org_id, reminder_day). Insert happens in the same transaction as the Resend send.';

grant select, insert on public.trial_reminder_sends to service_role;
