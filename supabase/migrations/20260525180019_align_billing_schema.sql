-- 20260525010100_align_billing_schema.sql

alter table public.organizations
  add column if not exists trial_started_at timestamp with time zone;

alter table public.organizations
  add column if not exists trial_ends_at timestamp with time zone;

alter table public.organizations
  add column if not exists stripe_price_id text;

alter table public.organizations
  add column if not exists current_period_end timestamp with time zone;

alter table public.organizations
  add column if not exists cancel_at_period_end boolean not null default false;

alter table public.organizations
  add column if not exists payment_state text;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'organizations_subscription_tier_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      drop constraint organizations_subscription_tier_check;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_subscription_tier_check_v2'
      and conrelid = 'public.organizations'::regclass
  ) then
    update public.organizations
      set subscription_tier = case lower(subscription_tier)
        when 'starter' then 'entry'
        when 'pro' then 'mid'
        when 'agency' then 'top'
        else subscription_tier
      end
      where lower(subscription_tier) in ('starter','pro','agency');

    alter table public.organizations
      add constraint organizations_subscription_tier_check_v2
      check (subscription_tier in ('free','entry','mid','top','suspended'));
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_payment_state_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_payment_state_check
      check (payment_state is null or length(payment_state) > 0);
  end if;
end$$;

create unique index if not exists organizations_stripe_customer_id_uniq
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists organizations_stripe_subscription_id_uniq
  on public.organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;
