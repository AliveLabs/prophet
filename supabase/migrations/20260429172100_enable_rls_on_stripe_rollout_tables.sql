-- Enable RLS on the two `public.*` tables that the 2026-04-27 Supabase
-- security advisor flagged with `rls_disabled_in_public` (lint 0013):
--   • public.stripe_webhook_events  (Stripe webhook idempotency ledger)
--   • public.trial_reminder_sends   (trial reminder cron dedupe log)
-- Both were created in 20260424182306_stripe_production.sql with grants only
-- to service_role (no anon/authenticated access), so this is belt-and-
-- suspenders rather than closing an active leak. Service_role bypasses RLS
-- by design, so the webhook handler at app/api/stripe/webhook/route.ts and
-- the cron at app/api/cron/trial-reminders/route.ts keep working unchanged.
--
-- The explicit anon-deny policies mirror the pattern in the marketing schema
-- (see marketing.{contacts,email_log,events,failed_events}_anon_deny in
-- 20260424152231_marketing_stream1_schema.sql) so reviewers can see the
-- intent without having to remember that RLS-on-no-policy denies by default.

alter table public.stripe_webhook_events enable row level security;
alter table public.trial_reminder_sends  enable row level security;

drop policy if exists stripe_webhook_events_anon_deny on public.stripe_webhook_events;
drop policy if exists trial_reminder_sends_anon_deny  on public.trial_reminder_sends;

create policy stripe_webhook_events_anon_deny
  on public.stripe_webhook_events for all to anon
  using (false) with check (false);

create policy trial_reminder_sends_anon_deny
  on public.trial_reminder_sends for all to anon
  using (false) with check (false);
