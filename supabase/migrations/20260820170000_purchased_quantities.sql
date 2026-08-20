-- ALT-687 — locations and competitors become PURCHASED QUANTITIES, not tier caps.
--
-- The new price sheet meters both: the plan includes some, and anything beyond is bought as a
-- Stripe subscription-item quantity. These two columns mirror those quantities so the pipeline
-- and the UI never depend on a live Stripe call to know what a customer is entitled to.
--
--     effective cap = TIER_LIMITS[tier].included* + organizations.*_purchased
--
-- Written by the Stripe webhook (lib/stripe/helpers.ts applySubscriptionToOrg), which sums the
-- quantity of every add-on item on the subscription. Read only through
-- resolveLocationAllowance / resolveCompetitorAllowance in lib/billing/limits.ts.
--
-- DEFAULT 0 and NOT NULL is the safety property: every existing row, and any org created before
-- the add-on prices exist in Stripe, behaves exactly as it did before this migration. There is no
-- backfill to do and no window where a customer gains or loses access.

alter table public.organizations
  add column if not exists locations_purchased integer not null default 0,
  add column if not exists competitors_purchased integer not null default 0;

-- A negative quantity is meaningless and would SHRINK the included allowance below what the plan
-- promises. The resolver clamps at 0 too, but a bad webhook payload should not be able to persist
-- a value the database itself considers invalid.
alter table public.organizations
  add constraint organizations_locations_purchased_nonneg
    check (locations_purchased >= 0) not valid;

alter table public.organizations
  add constraint organizations_competitors_purchased_nonneg
    check (competitors_purchased >= 0) not valid;

-- Existing rows are all 0 by the default above, so validating is free and immediate.
alter table public.organizations validate constraint organizations_locations_purchased_nonneg;
alter table public.organizations validate constraint organizations_competitors_purchased_nonneg;

comment on column public.organizations.locations_purchased is
  'ALT-687: additional locations bought on top of the plan allowance, mirrored from the Stripe subscription item quantity. Effective cap = TIER_LIMITS.includedLocations + this. Never read directly; use resolveLocationAllowance().';

comment on column public.organizations.competitors_purchased is
  'ALT-687: additional competitors PER LOCATION bought on top of the plan allowance, mirrored from the Stripe subscription item quantity. Effective cap = TIER_LIMITS.includedCompetitorsPerLocation + this. Never read directly; use resolveCompetitorAllowance().';
