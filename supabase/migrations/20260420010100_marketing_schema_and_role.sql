-- Phase 3 marketing automation: create `marketing` schema and scoped `marketing_ops` role.
--
-- This migration is owned by the product side. Chris (marketing automation) owns the
-- actual `marketing.contacts / email_log / events / failed_events` tables and views,
-- which deploy as a follow-up migration run by the `marketing_ops` role.
--
-- Scope rationale: n8n will store the `marketing_ops` JWT in its own vault. If that
-- credential is ever compromised, blast radius is limited to the marketing schema
-- plus the few product columns the lifecycle flows legitimately read. The product's
-- `service_role` is never exposed to n8n.
--
-- After applying this migration, an operator must ALSO:
--   1) Add `marketing` to Supabase Settings -> API -> Exposed schemas so PostgREST /
--      supabase-js `.schema('marketing')` calls reach it.
--   2) Issue a JWT with `"role": "marketing_ops"` signed by the project's JWT secret
--      (Supabase dashboard -> Project Settings -> API -> JWT Settings) and hand it to
--      Chris via 1Password.

begin;

-- 1. Schema.
create schema if not exists marketing;

-- 2. Role. CREATE ROLE has no IF NOT EXISTS, so wrap in a DO block for idempotence.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'marketing_ops') then
    create role marketing_ops noinherit nologin;
  end if;
end
$$;

comment on role marketing_ops is
  'Phase 3 marketing automation. Scoped to `marketing.*` plus narrow cross-schema reads. '
  'Never grant access to product signal tables (insights, snapshots, competitors, etc.).';

-- 3. Supabase role chain. In Supabase, PostgREST switches to the role in the JWT
-- `role` claim, and that role must be grantable to `authenticator`. We also grant
-- marketing_ops to postgres so the schema owner / DBA can act as marketing_ops
-- when applying follow-up migrations.
grant marketing_ops to authenticator;
grant marketing_ops to postgres;

-- 4. Schema access. CREATE is required so marketing_ops can run Chris's DDL
-- (CREATE TABLE, CREATE VIEW) when his migration is applied with
-- `SET ROLE marketing_ops;` at the top.
grant usage, create on schema marketing to marketing_ops;

-- The product backend (Stripe webhook, waitlist route, posthog-bridge) writes
-- into marketing.contacts via the service_role key. Grant USAGE explicitly so
-- those writes don't fail with `permission denied for schema marketing` if
-- this migration lands before Chris's schema file (which also does this
-- grant). Tables / sequences grants live in Chris's file because the tables
-- don't exist yet.
grant usage on schema marketing to service_role;

-- 5. Default privileges. Anything marketing_ops creates in the marketing schema
-- keeps it accessible to marketing_ops. Also mirror to postgres so DBAs can maintain.
alter default privileges for role marketing_ops in schema marketing
  grant all on tables to marketing_ops;
alter default privileges for role marketing_ops in schema marketing
  grant all on sequences to marketing_ops;
alter default privileges for role marketing_ops in schema marketing
  grant execute on functions to marketing_ops;

-- 6. Narrow cross-schema reads. The marketing flow legitimately needs three things
-- from the product side:
--   (a) auth.users.last_sign_in_at to suppress Day-3 onboarding email if user logged in
--   (b) organizations.{industry_type, stripe_*, trial_*, subscription_tier} for
--       lifecycle transitions (trial_started -> paid -> churned)
--   (c) waitlist_signups to reconcile pending/approved state with marketing.contacts
grant usage on schema public to marketing_ops;
grant usage on schema auth to marketing_ops;

grant select (id, email, last_sign_in_at, created_at)
  on auth.users to marketing_ops;

grant select (
  id,
  name,
  slug,
  industry_type,
  subscription_tier,
  stripe_customer_id,
  stripe_subscription_id,
  trial_started_at,
  trial_ends_at,
  billing_email,
  created_at,
  updated_at
) on public.organizations to marketing_ops;

grant select on public.waitlist_signups to marketing_ops;

-- 7. Explicitly withheld (documented, not executed). marketing_ops has NO access to:
--   - public.insights, public.snapshots, public.location_snapshots, public.competitors
--   - public.locations, public.competitor_photos, public.busy_times, public.location_weather
--   - public.social_profiles, public.social_snapshots, public.tracked_keywords
--   - public.event_matches, public.job_runs, public.refresh_jobs
--   - public.profiles (email is on auth.users; profiles PII stays product-side)
--   - public.admin_activity_log, public.platform_admins, public.insight_preferences
--   - public.organization_members (membership is product-internal)
-- Any table added to public.* in the future will be inaccessible to marketing_ops
-- unless explicitly granted here. This is by design.

commit;
