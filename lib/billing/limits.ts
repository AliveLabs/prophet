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

// ---------------------------------------------------------------------------
// Events Intelligence guardrails
// ---------------------------------------------------------------------------

export function getEventsCadence(
  tier: SubscriptionTier
): "weekly" | "daily" {
  return TIER_LIMITS[tier].eventsCadence
}

export function getEventsQueriesPerRun(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].eventsQueriesPerRun
}

export function getEventsMaxDepth(tier: SubscriptionTier): number {
  return Math.min(TIER_LIMITS[tier].eventsMaxDepth, 20) // hard cap
}

export function ensureEventQueryLimit(
  tier: SubscriptionTier,
  queriesRequested: number
): void {
  const limit = TIER_LIMITS[tier].eventsQueriesPerRun
  if (queriesRequested > limit) {
    throw new Error(
      `Event query limit exceeded for ${tier} tier (max ${limit}, requested ${queriesRequested}).`
    )
  }
}

// ---------------------------------------------------------------------------
// SEO Search Intelligence guardrails
// ---------------------------------------------------------------------------

export function getSeoTrackedKeywordsLimit(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].seoTrackedKeywords
}

export function getSeoLabsCadence(tier: SubscriptionTier): "weekly" | "daily" {
  return TIER_LIMITS[tier].seoLabsCadence
}

export function getSeoSerpCadence(tier: SubscriptionTier): "weekly" | "daily" {
  return TIER_LIMITS[tier].seoSerpCadence
}

export function getSeoRankedKeywordsLimit(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].seoRankedKeywordsLimit
}

export function isSeoIntersectionEnabled(tier: SubscriptionTier): boolean {
  return TIER_LIMITS[tier].seoIntersectionEnabled
}

export function getSeoIntersectionLimit(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].seoIntersectionLimit
}

export function isSeoAdsEnabled(tier: SubscriptionTier): boolean {
  return TIER_LIMITS[tier].seoAdsEnabled
}

export function ensureTrackedKeywordLimit(
  tier: SubscriptionTier,
  currentCount: number
): void {
  const limit = TIER_LIMITS[tier].seoTrackedKeywords
  if (currentCount >= limit) {
    throw new Error(
      `Tracked keyword limit reached for ${tier} tier (max ${limit}).`
    )
  }
}
