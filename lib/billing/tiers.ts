// Tier definitions for Ticket & Neat per the Apr 2026 pricing brief
// (app/docs/Ticket_Neat_Pricing_Brief_Apr2026.txt). One backend; two brands
// differentiated by organizations.industry_type; same tier prices and feature
// gates per tier across brands. Display names diverge per brand.
//
// Public surface used by the pricing page / upgrade buttons: includedLocations,
// includedCompetitorsPerLocation, socialPlatforms, seoCadence, runCadence,
// photoAnalysisDepth, retentionDays, whiteLabelReports, apiAccess, support.
// Everything else (eventsQueriesPerRun, seoTrackedKeywords, etc.) is an
// internal pipeline-tuning knob not sold on the pricing page.

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
export type SupportTier = "email" | "email_chat" | "dedicated"

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
  photoAnalysisDepth: number
  retentionDays: number
  whiteLabelReports: boolean
  apiAccess: boolean
  support: SupportTier

  // --- Internal pipeline tuning (not sold) -------------------------------
  eventsQueriesPerRun: number
  eventsMaxDepth: number
  eventsKeywordSets: number
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
    photoAnalysisDepth: 10,
    retentionDays: 30,
    whiteLabelReports: false,
    apiAccess: false,
    support: "email",
    runCadence: "weekly",
    eventsQueriesPerRun: 1,
    eventsMaxDepth: 10,
    eventsKeywordSets: 2,
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
    photoAnalysisDepth: 30,
    retentionDays: 90,
    whiteLabelReports: true,
    apiAccess: false,
    support: "email_chat",
    runCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    eventsKeywordSets: 5,
    seoTrackedKeywords: 50,
    seoRankedKeywordsLimit: 100,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 100,
    seoAdsEnabled: true,
    contentPagesPerRun: 5,
  },
  top: {
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
    photoAnalysisDepth: 30,
    retentionDays: 365,
    whiteLabelReports: true,
    apiAccess: true,
    support: "dedicated",
    runCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    eventsKeywordSets: 5,
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
    photoAnalysisDepth: 0,
    retentionDays: 0,
    whiteLabelReports: false,
    apiAccess: false,
    support: "email",
    runCadence: "weekly",
    eventsQueriesPerRun: 0,
    eventsMaxDepth: 0,
    eventsKeywordSets: 0,
    seoTrackedKeywords: 0,
    seoRankedKeywordsLimit: 0,
    seoIntersectionEnabled: false,
    seoIntersectionLimit: 0,
    seoAdsEnabled: false,
    contentPagesPerRun: 0,
  },
}

// Per-brand tier display names. Drives the billing page, upgrade buttons,
// trial gate, emails, and any admin copy that shows a customer what they bought.
const DISPLAY_NAMES: Record<IndustryType, Record<SubscriptionTier, string>> = {
  restaurant: {
    entry: "Table",
    mid: "Shift",
    top: "House",
    suspended: "Suspended",
  },
  liquor_store: {
    entry: "Well",
    mid: "Call",
    top: "Top Shelf",
    suspended: "Suspended",
  },
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
export const SELF_SERVE_TIERS: readonly SubscriptionTier[] = ["entry", "mid"] as const

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

// ── Display names ───────────────────────────────────────────────────────────────────────────
// ONE source. There were two copies of a `tierLabel` that rendered "Tier 1 / Tier 2 / Tier 3" to
// customers, in app/(dashboard)/operator-data.ts and app/preview/preview-data.ts. "Tier 2" is
// internal shorthand that tells an operator nothing about what they bought, and it breaks the
// customer-facing voice rule. Legacy DB values are mapped so an old row still renders.
const TIER_DISPLAY_NAMES: Record<string, string> = {
  entry: "Starter",
  mid: "Standard",
  top: "Multi-Location",
  suspended: "Paused",
  // Legacy subscription_tier values still present on old rows.
  tier_1: "Starter",
  tier_2: "Standard",
  tier_3: "Multi-Location",
  free: "Trial",
}

/** What to call a plan in front of a customer. Never render a raw tier key. */
export function tierDisplayName(tier: string): string {
  return TIER_DISPLAY_NAMES[tier] ?? "Starter"
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

// The next paid tier up in location count (the smallest includedLocations strictly
// greater than `tier`'s) — i.e. the "upgrade to fit another location on this same
// bill" target. null when the org is already at the most-locations tier (then the
// only way to add more is a separate account). Drives the decision screen (A2 2a).
export function nextTierWithMoreLocations(
  tier: SubscriptionTier
): SubscriptionTier | null {
  const current = TIER_LIMITS[asSubscriptionTier(tier)].includedLocations
  let best: SubscriptionTier | null = null
  for (const t of PAID_TIERS) {
    if (
      TIER_LIMITS[t].includedLocations > current &&
      (best === null || TIER_LIMITS[t].includedLocations < TIER_LIMITS[best].includedLocations)
    ) {
      best = t
    }
  }
  return best
}
