// Tier definitions for Ticket & Neat per the Apr 2026 pricing brief
// (app/docs/Ticket_Neat_Pricing_Brief_Apr2026.txt). One backend; two brands
// differentiated by organizations.industry_type; same tier prices and feature
// gates per tier across brands. Display names diverge per brand.
//
// Public surface used by the pricing page / upgrade buttons: includedLocations,
// includedCompetitorsPerLocation, socialPlatforms, seoCadence, runCadence,
// and nothing else. `photoAnalysisDepth`, `retentionDays` and `support` USED TO BE HERE and are
// gone (ALT-734): all three had zero readers, so they were config that described an intention
// rather than gating a behaviour. Same reasoning as the ALT-733 note below. When retention or a
// support tier is actually enforced, the field returns WITH its reader.
// Everything else (eventsQueriesPerRun, seoTrackedKeywords, etc.) is an
// internal pipeline-tuning knob not sold on the pricing page.
//
// ALT-733: `whiteLabelReports` and `apiAccess` USED TO LIVE HERE and are deliberately gone.
// Both were booleans whose only effect was to push "White-label reports" / "API access" into a
// customer-facing feature list; `isWhiteLabelEnabled` and `isApiAccessEnabled` existed and had
// ZERO callers, and there is no white-label renderer and no public API in this codebase. So the
// flags did not gate a feature, they only advertised one.
//
// Do not re-add them as booleans ahead of the feature. A flag that no code reads cannot be
// "turned on" later; it can only make the claim reappear. When white-label or an API actually
// ships, the field comes back WITH the reader that enforces it, in the same change.
//
// ── THE RULE, now enforced (ALT-691) ──────────────────────────────────────────────────────────
//
// A field in `TIER_LIMITS` must have an ENFORCEMENT SITE, or it does not belong here.
//
// This is not tidiness. A field that DESCRIBES the system without CONTROLLING it will eventually
// be priced or gated from, because it reads as authoritative to anyone scanning this file. That
// already happened: the first cost-to-serve estimate put the top tier at ~28x the mid tier's
// search volume, and that number came from reading `seoLabsCadence: "daily"`, a field with zero
// readers. The field the pipeline actually honours says `biweekly`.
//
// `eventsKeywordSets` was deleted here for the same reason: it had zero readers anywhere, so it
// described an events-probe behaviour that no code implemented.
//
// The cost model does NOT count as an enforcement site. `lib/billing/tier-cost.ts` may only read
// fields the pipeline honours, which is exactly the constraint that got violated above, so a field
// read solely by the cost model is still dead. `tests/unit/billing/tier-limits-have-readers.ts`
// walks the AST and fails if any field here is never read outside this file and the cost model.

import type { IndustryType } from "@/lib/verticals"

// There is no free tier — there is a free TRIAL, and the trial is OF the mid
// tier (brief § Trial Strategy). Orgs that never completed checkout are gated
// by lib/billing/trial.ts (null payment_state + internal trial clock), not by
// a tier value. Legacy 'free' DB rows read as 'entry' via asSubscriptionTier
// until the prod migration lands.
export type SubscriptionTier =
  | "entry"
  | "mid"
  | "top"
  | "suspended"

export type Cadence = "monthly" | "annual"

export type SocialPlatform = "instagram" | "facebook" | "tiktok"

export type SeoCadence = "weekly" | "biweekly" // biweekly = 2x / week

export const ALL_SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  "instagram",
  "facebook",
  "tiktok",
] as const

export type TierLimits = {
  // --- Brief-visible fields (pricing page) -------------------------------
  /** ALT-687 — the locations INCLUDED in the plan, not the ceiling. The effective cap is
   *  `included + purchased`; resolve it with resolveLocationAllowance(org), never by reading
   *  this directly. Renamed from `maxLocations` so a stale read fails to compile. */
  includedLocations: number
  /** ALT-687 — competitors INCLUDED per location, not the ceiling. Use
   *  resolveCompetitorAllowance(org). Renamed from `maxCompetitorsPerLocation`. */
  includedCompetitorsPerLocation: number
  /** How many OWN-account networks this tier collects. Entry = ONE network of
   *  the customer's choice (locations.settings.ownSocialNetwork, default
   *  instagram); mid/top = all three. Resolve via resolveOwnSocialNetworks. */
  ownSocialNetworkLimit: number
  /** Competitor monitoring covers every network we find on EVERY tier — the
   *  customer's own-network choice never limits competitor coverage. */
  competitorSocialNetworks: readonly SocialPlatform[]
  seoCadence: SeoCadence
  /** ALT-683 — HOW OFTEN A LOCATION RUNS AT ALL, and therefore how often a brief
   *  appears. THIS is the field the daily cron gates on, and the brief cadence the
   *  pricing page sells. It was called `eventsCadence` and lived under "internal
   *  pipeline tuning (not sold)" while a `briefingCadence` in this block enforced
   *  NOTHING: the thing we sell was gated by a field named after something else.
   *
   *  It never gated events specifically. `events` is unconditionally in the pipeline
   *  list, so the old name was wrong from the first commit.
   *
   *  Do not add a second cadence field that has to agree with this one. Two fields
   *  that must match, with nothing enforcing the match, IS the bug this replaced. */
  runCadence: "weekly" | "daily"

  // --- Internal pipeline tuning (not sold) -------------------------------
  eventsQueriesPerRun: number
  eventsMaxDepth: number
  seoTrackedKeywords: number
  seoRankedKeywordsLimit: number
  seoIntersectionEnabled: boolean
  seoIntersectionLimit: number
  seoAdsEnabled: boolean
  contentPagesPerRun: number
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  entry: {
    includedLocations: 1,
    includedCompetitorsPerLocation: 3,
    ownSocialNetworkLimit: 1,
    competitorSocialNetworks: ALL_SOCIAL_PLATFORMS,
    seoCadence: "weekly",
    runCadence: "weekly",
    eventsQueriesPerRun: 1,
    eventsMaxDepth: 10,
    seoTrackedKeywords: 15,
    seoRankedKeywordsLimit: 50,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 25,
    seoAdsEnabled: false,
    contentPagesPerRun: 3,
  },
  mid: {
    includedLocations: 1,
    includedCompetitorsPerLocation: 5,
    ownSocialNetworkLimit: 3,
    competitorSocialNetworks: ALL_SOCIAL_PLATFORMS,
    seoCadence: "weekly",
    runCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    seoTrackedKeywords: 50,
    seoRankedKeywordsLimit: 100,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 100,
    seoAdsEnabled: true,
    contentPagesPerRun: 5,
  },
  top: {
    // ── `top` IS THE CONTRACT VEHICLE. Do not delete it. ────────────────────────────────────
    //
    // It looks like dead code: nothing is on it, it is absent from SELF_SERVE_TIERS, and the
    // customer-facing offer is "Starter, Standard, Custom". It is none of those things. It is the
    // billing vehicle a signed Multi-Location deal lands on, and it exists precisely so a
    // negotiated per-location rate is billable at all: modelling a custom customer as Standard plus
    // N location add-ons would force them onto the add-on LIST price, which defeats the quote.
    //
    // Keeping it also means the Stripe product and price already exist when the first deal closes
    // rather than being created under deadline. See docs/PRICING.md section 1a, written so this
    // question stops being re-argued.
    //
    // What keeps it safe is the self-serve gate, not its absence: `isSelfServeTier("top")` is false
    // and both money endpoints check it, because `top` undercuts Standard per location while
    // delivering more, and was briefly purchasable (ALT-735).
    //
    // Its entitlement below is a DEFAULT for a negotiated deal, not a published promise. A Custom
    // arrangement is priced per deal because we do not yet know what supporting one takes, so do
    // not compute a margin floor from these numbers and treat it as a gate: the 70%/60% gates guard
    // PUBLISHED self-serve prices, where no human is judging. A contract can be worth more than its
    // contribution margin. See docs/PRICING.md section 1. (This is where ALT-757 landed, closed by
    // decision rather than by changing a number.)
    //
    // Worth knowing: there is no per-org entitlement override, so a signed deal either matches these
    // defaults or needs one built. Locations and competitors are purchasable; cadence and the SEO
    // allocation are not adjustable per customer.
    //
    // ALT-687/657 — ONE. Multi-Location is priced PER LOCATION ($275/mo each), so a single unit
    // of it is one location and the rest arrive as `locations_purchased`. This was 3 under the old
    // bundle model ($499 for three), and leaving it at 3 made the cost model compare three
    // locations' cost against one location's price, which is what surfaced this: the estimate came
    // out at $280.60 against a $275 "price". Every tier now includes exactly one location.
    includedLocations: 1,
    includedCompetitorsPerLocation: 10,
    ownSocialNetworkLimit: 3,
    competitorSocialNetworks: ALL_SOCIAL_PLATFORMS,
    seoCadence: "biweekly",
    runCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    seoTrackedKeywords: 200,
    seoRankedKeywordsLimit: 500,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 500,
    seoAdsEnabled: true,
    contentPagesPerRun: 8,
  },
  suspended: {
    includedLocations: 0,
    includedCompetitorsPerLocation: 0,
    ownSocialNetworkLimit: 0,
    competitorSocialNetworks: [] as const,
    seoCadence: "weekly",
    runCadence: "weekly",
    eventsQueriesPerRun: 0,
    eventsMaxDepth: 0,
    seoTrackedKeywords: 0,
    seoRankedKeywordsLimit: 0,
    seoIntersectionEnabled: false,
    seoIntersectionLimit: 0,
    seoAdsEnabled: false,
    contentPagesPerRun: 0,
  },
}

// ALT-657 — the customer-facing plan names. Drives the billing page, upgrade buttons, the trial
// gate, the trial-reminder emails, the held-account panel and the onboarding trial screen. This is
// the one that reaches customers; it was still "Table / Shift / House" and "Well / Call / Top
// Shelf" after the Stripe products had already been renamed, so the invoice said one thing and the
// app said another.
//
// Deliberately IDENTICAL across brands, and referenced from ONE object so they cannot drift
// apart by someone updating a single side. Table/Shift/House and Well/Call/Top Shelf were jargon
// that told a buyer nothing about what they were getting. If a brand ever genuinely needs its own
// names, split this then, with a reason.
const PLAIN_TIER_NAMES: Record<SubscriptionTier, string> = {
  entry: "Starter",
  mid: "Standard",
  top: "Multi-Location",
  // Not "Suspended": that is our word for our state. The operator experiences a pause.
  suspended: "Paused",
}

const DISPLAY_NAMES: Record<IndustryType, Record<SubscriptionTier, string>> = {
  restaurant: PLAIN_TIER_NAMES,
  liquor_store: PLAIN_TIER_NAMES,
}

export function getTierDisplayName(
  tier: SubscriptionTier,
  industry: IndustryType
): string {
  return DISPLAY_NAMES[industry][tier]
}

// Only the mid tier offers a free trial (brief section 3/4 "Trial Strategy").
// Card required on checkout; trial_period_days=14; Day 10 + Day 13 reminders.
export const TRIAL_ELIGIBLE_TIERS: readonly SubscriptionTier[] = [
  "mid",
] as const

export function isTrialEligibleTier(tier: SubscriptionTier): boolean {
  return TRIAL_ELIGIBLE_TIERS.includes(tier)
}

// Canonical list of paid tiers for iteration (upgrade buttons, Portal allowed
// products, cron filters). Order matches the pricing page display order.
export const PAID_TIERS: readonly SubscriptionTier[] = [
  "entry",
  "mid",
  "top",
] as const

// Tiers a visitor can buy WITHOUT talking to us. Multi-Location is contract-only: priced per
// location against the schedule in §5 of the pricing doc, so it has no self-serve checkout and no
// upgrade tile. It stays in PAID_TIERS because existing contracts still resolve through it.
//
// ALT-770: `satisfies`, NOT a `readonly SubscriptionTier[]` annotation. The annotation used to
// throw away the literal types that `as const` had just established, so iterating this constant
// yielded the whole SubscriptionTier union (`top` and `suspended` included) and every consumer
// re-narrowed by hand. Keeping the literals is what let the compiler find the -1 bug below.
export const SELF_SERVE_TIERS = ["entry", "mid"] as const satisfies readonly SubscriptionTier[]

// ── Which direction is a plan change? (ALT-770) ───────────────────────────────────────────────
//
// THE BUG this replaces. The billing plan-change screen decided its Upgrade-versus-Downgrade
// label with `SELF_SERVE_TIERS.indexOf(t) > SELF_SERVE_TIERS.indexOf(currentTier)`. That list is
// `["entry", "mid"]` and does not contain `top`, so for a Multi-Location customer `indexOf`
// returned -1 and BOTH comparisons (`0 > -1`, `1 > -1`) came out true. The screen told them that
// moving to Starter was an upgrade: the label on the button that changes what they pay said the
// opposite of what the button does.
//
// The class of mistake is ranking against a list that does not contain every value it will be
// asked about, and getting a plausible number back instead of an error. Same shape as ALT-754's
// `nextTierWithMoreLocations`. So this ranks against a map that covers every tier that HAS a
// rank, and returns "unknown" for anything else rather than a direction it cannot justify.
//
// The ordering is ENTITLEMENT, not price. `top` sits above `mid` because it delivers more, even
// though its list price is lower per the arbitrage documented on `isSelfServeTier`. A customer
// reading "Downgrade" wants to know they are giving something up, which is true of top → mid
// whatever the invoice says.
//
// `suspended` deliberately has no rank. It is an account STATE, not a rung: moving off it is
// neither up nor down, and inventing a position for it is how a wrong label gets rendered
// confidently. It resolves to "unknown", and the caller shows a neutral label.
const TIER_RANK: Record<Exclude<SubscriptionTier, "suspended">, number> = {
  entry: 0,
  mid: 1,
  top: 2,
}

export type PlanChangeDirection = "upgrade" | "downgrade" | "same" | "unknown"

function tierRank(tier: unknown): number | null {
  if (typeof tier !== "string") return null
  return tier in TIER_RANK ? TIER_RANK[tier as keyof typeof TIER_RANK] : null
}

/** Is moving from `from` to `to` an upgrade, a downgrade, or something we should not label?
 *
 *  Takes `unknown` on purpose: the current tier reaches the billing screen from a DB column, so
 *  a legacy or unrecognised value is a real input, and it must produce "unknown" rather than a
 *  coincidental comparison against a missing index. */
export function planChangeDirection(from: unknown, to: unknown): PlanChangeDirection {
  const a = tierRank(from)
  const b = tierRank(to)
  if (a === null || b === null) return "unknown"
  if (a === b) return "same"
  return b > a ? "upgrade" : "downgrade"
}

/** ALT-735/732: the ONE gate for "can a customer buy this without talking to us".
 *
 *  Every buying surface and every purchase endpoint must ask THIS, not `isPaidTier`. The
 *  difference was a live Critical: the held-account panel iterated PAID_TIERS, so it rendered
 *  Multi-Location at $2,750/yr beside Standard at $2,990/yr with strictly more entitlement
 *  (10 competitors vs 5, biweekly SEO vs weekly, 365-day retention vs 90) as a one-click upgrade,
 *  and /api/stripe/checkout accepted the tier because it validated with PAID_TIERS too. Both
 *  Multi-Location prices are live and active in Stripe, so the purchase completed: a rational
 *  buyer took the cheaper, better plan and we lost $240/yr of contribution per account. Monthly
 *  had the same inversion, $275 against $299.
 *
 *  PAID_TIERS answers "is this a real paid tier" (webhooks, cron filters, resolving an existing
 *  contract). It is the wrong question to ask at a checkout. */
export function isSelfServeTier(
  tier: unknown
): tier is Exclude<SubscriptionTier, "suspended" | "top"> {
  return typeof tier === "string" && (SELF_SERVE_TIERS as readonly string[]).includes(tier)
}

/** "Is this one of our real paid tiers." Correct for webhooks, cron filters and resolving an
 *  existing subscription. NOT a purchase gate: use isSelfServeTier for that.
 *
 *  Lives here because both /api/stripe/checkout and /api/stripe/change-plan had their own
 *  byte-identical private copy, and both were wired to the wrong question. */
export function isPaidTier(tier: unknown): tier is Exclude<SubscriptionTier, "suspended"> {
  return typeof tier === "string" && (PAID_TIERS as readonly string[]).includes(tier)
}

// ── Prices, per docs/PRICING-2026-08-19.md (authoritative) ───────────────────────────────────
//
// ANNUAL = MONTHLY × 10, i.e. "two months free" (16.7%), replacing the old 20% off. That
// construction is the reason the effective monthlies are round numbers: $119 × 10 / 12 = $99.17.
// Derived rather than hand-typed, because hand-typed cents is how a price sheet and a Stripe
// account drift apart.
const MONTHS_PER_ANNUAL = 10

function priceLine(monthly: number) {
  const annual = monthly * MONTHS_PER_ANNUAL
  return { monthly, annual, annualEffectiveMonthly: Math.round(annual / 12) }
}

/** Months not charged on annual. 12 - 10 = 2. */
export const ANNUAL_MONTHS_FREE = 12 - MONTHS_PER_ANNUAL

/** The real annual discount, to one decimal: 16.7, not 20. */
export const ANNUAL_DISCOUNT_PCT =
  Math.round((1 - MONTHS_PER_ANNUAL / 12) * 1000) / 10

const MONTHS_FREE_WORD: Record<number, string> = { 1: "One", 2: "Two", 3: "Three" }

/** ALT-736: the ONE phrase every surface uses for the annual saving.
 *
 *  Three buying surfaces each hardcoded "save 20%" while the same components' cadence toggles
 *  said "Two months free". Both cannot be true: annual is monthly x 10, which is two months
 *  free, which is 16.7%. So we advertised a 20% discount and charged a 16.7% one on every
 *  buying screen we have, which is the kind of claim a customer checks with a calculator.
 *
 *  Derived from MONTHS_PER_ANNUAL rather than written out, so changing the annual construction
 *  moves the copy with it instead of leaving a stale number behind. Spelled as a word because
 *  this is premium buying-surface copy, not a data readout; a test pins the word to the number
 *  so the two cannot come apart. */
export const ANNUAL_SAVINGS_LABEL =
  ANNUAL_MONTHS_FREE === 1
    ? "One month free"
    : `${MONTHS_FREE_WORD[ANNUAL_MONTHS_FREE] ?? ANNUAL_MONTHS_FREE} months free`

/** The same phrase for use mid-sentence, after a separator. */
export const ANNUAL_SAVINGS_INLINE =
  ANNUAL_SAVINGS_LABEL.charAt(0).toLowerCase() + ANNUAL_SAVINGS_LABEL.slice(1)

// `top` is PER LOCATION and contract-only. The figure is the list rate at 0% discount, which is
// where a quote starts, not a published price. Hard floor is $165/location on daily.
export const TIER_PRICING: Record<
  Exclude<SubscriptionTier, "suspended">,
  { monthly: number; annual: number; annualEffectiveMonthly: number }
> = {
  entry: priceLine(119), // Starter:  $119/mo, $99/mo on annual
  mid: priceLine(299), // Standard: $299/mo, $249/mo on annual
  top: priceLine(275), // Multi-Location, per location, contract only
}

// ── ALT-687: the metered add-ons ─────────────────────────────────────────────────────────────
// ⚠️ INVARIANT: an add-on may never cost more than the base plan it attaches to. $229 < $249 is
// what stops a customer opening a second account instead of adding a location. An earlier draft
// priced the add-on at $269 against a $99 base, and a two-location customer saved $370 by
// splitting. A test pins this; do not edit these numbers without reading it.
// An additional LOCATION is priced PER PLAN, because the sheet's own rule is "additional
// locations run on the same plan as the first" and the same plan has to mean the same price.
//
// A single flat $229 add-on breaks the invariant for Starter: $229 against a $99 base means two
// Starter accounts cost $198 where one two-location account costs $328, so the customer saves $130
// by splitting. That is the identical failure the $269 draft had, just smaller, and it survived
// into the decided sheet because only the Standard line was checked. Found by the guard test.
//
// Standard keeps its deliberate 8% discount ($229 against $249). Starter's add-on is priced at
// parity with its own base, which is the simplest arbitrage-free choice: splitting gains nothing.
export const ADD_ON_PRICING = {
  location: {
    entry: priceLine(119), // parity with the Starter base: $119/mo, $99/mo annual
    mid: priceLine(275), // $275/mo, $229/mo annual, an 8% discount on Standard
    top: priceLine(275), // Multi-Location is already per-location; same rate
  },
  // Flat, and far below either base, so no per-plan split is needed.
  competitor: priceLine(18), // $18/mo, $15/mo on annual. Confirmed by Bryan 2026-08-20.
} as const

/** The per-location add-on rate for the plan the account is on. */
export function addOnLocationPrice(tier: SubscriptionTier) {
  const t = tier === "suspended" ? "entry" : tier
  return ADD_ON_PRICING.location[t]
}

// ── Display names, brand-agnostic ───────────────────────────────────────────────────────────
// For callers that have a tier string and NO industry to hand: `tierLabel` in
// app/(dashboard)/operator-data.ts and app/preview/preview-data.ts, which used to be two separate
// copies of a map rendering "Tier 1 / Tier 2 / Tier 3" at customers.
//
// Reads PLAIN_TIER_NAMES rather than holding its own copy. Also maps the legacy
// subscription_tier values still present on old rows, which getTierDisplayName cannot because its
// key type is SubscriptionTier.
const LEGACY_TIER_ALIASES: Record<string, SubscriptionTier> = {
  tier_1: "entry",
  tier_2: "mid",
  tier_3: "top",
  free: "mid", // legacy free rows are trials, and a trial is of the mid plan
}

/** What to call a plan in front of a customer. Never render a raw tier key. */
export function tierDisplayName(tier: string): string {
  const canonical = (PLAIN_TIER_NAMES as Record<string, string>)[tier]
  if (canonical) return canonical
  const aliased = LEGACY_TIER_ALIASES[tier]
  return aliased ? PLAIN_TIER_NAMES[aliased] : PLAIN_TIER_NAMES.entry
}

// Resolve which OWN-account networks a tier actually collects for a location.
// Entry tiers carry the customer's chosen network (default instagram);
// mid/top get all three; suspended none.
export function resolveOwnSocialNetworks(
  tier: SubscriptionTier,
  chosen?: SocialPlatform | null
): readonly SocialPlatform[] {
  const limit = TIER_LIMITS[tier].ownSocialNetworkLimit
  if (limit <= 0) return []
  if (limit >= ALL_SOCIAL_PLATFORMS.length) return ALL_SOCIAL_PLATFORMS
  return [chosen ?? "instagram"]
}

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return value === "instagram" || value === "facebook" || value === "tiktok"
}

// Narrow guard for values read out of the DB. Legacy 'free' rows (pre-migration)
// and unknown values degrade to 'entry' — access is still gated by trial.ts
// (payment_state / trial clock), so this never grants product access by itself.
export function asSubscriptionTier(value: unknown): SubscriptionTier {
  if (
    value === "entry" ||
    value === "mid" ||
    value === "top" ||
    value === "suspended"
  ) {
    return value
  }
  return "entry"
}

// ALT-754: `nextTierWithMoreLocations` lived here and is gone. It answered "which tier fits another
// location on this same bill", and since every tier includes exactly ONE location it returned null
// for all of them, by construction. Its single caller was the at-limit screen on /locations/new,
// whose "Add it to this account" card therefore never rendered, leaving a second separate account as
// the product's only offer. That screen now sells the location ADD-ON instead, which is the honest
// answer and cheaper for a Standard operator ($275 against $299).
//
// If locations are ever bundled into a tier again, this is the shape to bring back.
