-- Trial & tier model v2 (2026-06-11, trial-tier-model-plan.md): there is no
-- free tier — there is a free TRIAL, and the trial is OF the mid tier.
--
-- 1) Existing 'free' orgs were trials all along; move them to 'mid'. Expired
--    ones stay blocked exactly as before (null payment_state + past
--    trial_ends_at fails lib/billing/trial.ts isTrialActive). Active
--    clock-trials (e.g. Bush's) get the Tier-2 trial experience the model
--    promises. Internal 'top' orgs untouched. Leads untouched.
update public.organizations
  set subscription_tier = 'mid'
  where subscription_tier = 'free';

-- 2) Orgs inserted without an explicit tier are trial-pending = mid (the
--    wizard sets it explicitly; this catches the legacy create action).
alter table public.organizations
  alter column subscription_tier set default 'mid';

-- NOTE: organizations_subscription_tier_check_v2 still allows 'free' on
-- purpose — code degrades any stray legacy value via asSubscriptionTier.
-- Tighten alongside the next DB-types regeneration.
