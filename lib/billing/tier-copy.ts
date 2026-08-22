// ALT-764: the one place that turns a tier's ENFORCED limits into the words a buyer reads.
//
// This exists because the landing page used to type its own numbers, and they drifted to the point
// of advertising 50 competitors per location against an enforced 5. The fix is not "retype them
// correctly", it is "there is nowhere left to type them".
//
// These are deliberately pure functions over TIER_LIMITS / TIER_PRICING rather than helpers inside
// the component. A function here can be asserted on its OUTPUT
// (tests/unit/billing/tier-copy-is-derived.test.ts), which a JSX component in this repo cannot be:
// vitest collects only tests/unit/**/*.test.ts, so nothing renders a .tsx. An earlier version of
// this lived in the component and the guard could only check that the file MENTIONED TIER_LIMITS,
// which an adversarial probe walked straight past by hardcoding a number two lines away.

import { TIER_LIMITS, TIER_PRICING, tierDisplayName, type SubscriptionTier } from "./tiers"

/** Tiers that can be bought online and therefore need buyer-facing copy. */
export type SellableTier = "entry" | "mid"

/** "A brief every morning" / "A weekly brief, every Monday", from runCadence. */
export function tierBriefLine(tier: SubscriptionTier): string {
  return TIER_LIMITS[tier].runCadence === "daily"
    ? "A brief every morning"
    : "A weekly brief, every Monday"
}

/** "5 competitors watched", from includedCompetitorsPerLocation. */
export function tierCompetitorLine(tier: SubscriptionTier): string {
  const n = TIER_LIMITS[tier].includedCompetitorsPerLocation
  return `${n} competitor${n === 1 ? "" : "s"} watched`
}

/** The monthly figure, unformatted, so the caller controls currency presentation. */
export function tierMonthlyPrice(tier: SellableTier): number {
  return TIER_PRICING[tier].monthly
}

/**
 * The price unit. Every tier includes exactly ONE location and further locations are add-ons, so
 * the honest unit is per location per month. This is also why no surface may advertise a bundled
 * location count: there is no bundle.
 */
export const PRICE_UNIT = "/location/month"

/** The tier's display name. Re-exported so a copy surface needs one import, not two. */
export function tierName(tier: SubscriptionTier): string {
  return tierDisplayName(tier)
}
