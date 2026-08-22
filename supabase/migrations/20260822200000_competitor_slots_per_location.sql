-- ALT-756: competitor add-on slots become PER LOCATION.
--
-- The defect: one purchased competitor unit granted +1 competitor at EVERY location, while the
-- price had no location term and the cost does. Contribution fell to 33% at 5 locations and the
-- line went underwater by $30.50/mo at 10, on list price. Bryan's decision 2026-08-22: a unit is
-- added to ONE location, so one location can run 4 competitors while another runs 3, and only the
-- one extra is billed.
--
-- ── The two-column split, which is NOT two copies of one fact ────────────────────────────────
--
--   organizations.competitors_purchased  = how many units the org is BILLED for.
--                                          A mirror of the Stripe subscription item quantity,
--                                          written by the webhook (lib/stripe/helpers.ts).
--   locations.competitors_purchased      = how those paid units are ALLOCATED.  (this migration)
--
-- Different questions: "what did you pay for" and "where did you put it". The invariant that ties
-- them together is SUM(locations) <= organizations, enforced in lib/billing/limits.ts and pinned by
-- a test. It is not expressible as a CHECK constraint because it spans two tables, and a trigger
-- would fire on every location write for a rule that only changes on purchase.
--
-- ── Safety ───────────────────────────────────────────────────────────────────────────────────
--
-- Zero customer impact. Verified against prod immediately before applying: all 5 live orgs hold
-- competitors_purchased = 0 and locations_purchased = 0, and each has exactly 1 location. So there
-- is nothing to allocate and no existing entitlement to preserve. Defaulting to 0 is therefore the
-- correct backfill rather than a lossy one: nobody has bought anything yet.
--
-- Under-counting is the safe direction here and is deliberate throughout limits.ts ("a bad read can
-- never widen a cap"). A missing or junk value yields 0 purchased, which denies a slot rather than
-- granting one for free.

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS competitors_purchased integer NOT NULL DEFAULT 0;

ALTER TABLE public.locations
  DROP CONSTRAINT IF EXISTS locations_competitors_purchased_non_negative;

ALTER TABLE public.locations
  ADD CONSTRAINT locations_competitors_purchased_non_negative
  CHECK (competitors_purchased >= 0);

COMMENT ON COLUMN public.locations.competitors_purchased IS
  'ALT-756: extra competitor slots ALLOCATED to this location. Paid units live on '
  'organizations.competitors_purchased (the Stripe quantity mirror); this is where they are placed. '
  'Invariant: SUM over an org must not exceed the org total. Enforced in lib/billing/limits.ts.';
