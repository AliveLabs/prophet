-- ALT-764: the tier check constraint still permits 'free', which is not a tier any more.
--
-- 'free' predates the Starter / Standard / Multi-Location naming. The app has no 'free' tier: it
-- survives only as a READ-side compatibility entry in LEGACY_TIER_ALIASES (lib/billing/tiers.ts),
-- which maps a legacy 'free' row to 'mid' on the grounds that those rows were trials of the mid
-- plan. Nothing in the codebase writes it (verified by grep across app/, lib/, scripts/ and
-- supabase/), and prod holds zero rows with it: `organizations.subscription_tier` is 'mid' (4) and
-- 'entry' (1) only.
--
-- Leaving it permitted means the database accepts a value the product cannot serve. That is how a
-- silent tier bug gets in: a bad write succeeds, the row reads back as 'mid' through the alias, and
-- the org is billed and gated as Standard forever with no error anywhere.
--
-- The alias itself STAYS. It costs nothing and it is the thing that keeps a restored backup or an
-- old export readable. This migration only stops NEW writes.
--
-- Safe to re-run: the constraint is dropped IF EXISTS before being re-added.

DO $$
DECLARE
  offending integer;
BEGIN
  -- Fail loudly rather than have ALTER TABLE reject the constraint with a less useful message.
  SELECT count(*) INTO offending
  FROM public.organizations
  WHERE subscription_tier IS NOT NULL
    AND subscription_tier NOT IN ('entry', 'mid', 'top', 'suspended');

  IF offending > 0 THEN
    RAISE EXCEPTION
      'ALT-764: % organization row(s) hold a tier outside (entry, mid, top, suspended). Migrate those rows before tightening the constraint.',
      offending;
  END IF;
END $$;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_subscription_tier_check_v2;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_subscription_tier_check_v2
  CHECK (subscription_tier = ANY (ARRAY['entry'::text, 'mid'::text, 'top'::text, 'suspended'::text]));
