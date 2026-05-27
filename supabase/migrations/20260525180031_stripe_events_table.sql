-- 20260525010200_stripe_events_table.sql

create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamp with time zone not null default now(),
  organization_id uuid references public.organizations(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text,
  price_id text,
  brand text,
  tier text,
  cadence text,
  skipped_reason text,
  warning text,
  error_message text,
  payload jsonb not null
);

create index if not exists stripe_events_received_at_idx
  on public.stripe_events (received_at desc);

create index if not exists stripe_events_event_type_idx
  on public.stripe_events (event_type);

create index if not exists stripe_events_organization_id_idx
  on public.stripe_events (organization_id);

create index if not exists stripe_events_skipped_reason_idx
  on public.stripe_events (skipped_reason)
  where skipped_reason is not null;

comment on table public.stripe_events is
  'Append-only audit + idempotency log for Stripe webhook events delivered to the Neat app. Includes dropped non-Neat-brand events.';
comment on column public.stripe_events.skipped_reason is
  'Reason this event was not applied to organizations (e.g. non_neat_brand, unresolvable_price, org_not_found, industry_mismatch).';
comment on column public.stripe_events.warning is
  'Non-fatal anomalies observed while processing (free-form).';
comment on column public.stripe_events.error_message is
  'Fatal error while processing — webhook returned 500 to force Stripe retry. Null on success.';

alter table public.stripe_events enable row level security;

drop policy if exists stripe_events_service_role_only on public.stripe_events;
create policy stripe_events_service_role_only
  on public.stripe_events
  for all
  using (false)
  with check (false);

revoke all on public.stripe_events from anon, authenticated;
grant select, insert, update on public.stripe_events to service_role;
