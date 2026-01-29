import { TIER_LIMITS, type SubscriptionTier } from "./tiers"

export function ensureLocationLimit(
  tier: SubscriptionTier,
  currentCount: number
): void {
  const limit = TIER_LIMITS[tier].maxLocations
  if (currentCount >= limit) {
    throw new Error(`Location limit reached for ${tier} tier.`)
  }
}

export function ensureCompetitorLimit(
  tier: SubscriptionTier,
  currentCount: number
): void {
  const limit = TIER_LIMITS[tier].maxCompetitorsPerLocation
  if (currentCount >= limit) {
    throw new Error(`Competitor limit reached for ${tier} tier.`)
  }
}
