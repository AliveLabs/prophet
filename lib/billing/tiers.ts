export type SubscriptionTier = "free" | "starter" | "pro" | "agency"

export type TierLimits = {
  maxLocations: number
  maxCompetitorsPerLocation: number
  retentionDays: number
  // Events Intelligence limits
  eventsCadence: "weekly" | "daily"
  eventsQueriesPerRun: number // max queries per location per run
  eventsMaxDepth: number // max depth per query (hard cap 20)
  eventsKeywordSets: number // configurable keywords (0 = default only)
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    maxLocations: 1,
    maxCompetitorsPerLocation: 5,
    retentionDays: 30,
    eventsCadence: "weekly",
    eventsQueriesPerRun: 1,
    eventsMaxDepth: 10,
    eventsKeywordSets: 0,
  },
  starter: {
    maxLocations: 3,
    maxCompetitorsPerLocation: 15,
    retentionDays: 90,
    eventsCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    eventsKeywordSets: 5,
  },
  pro: {
    maxLocations: 10,
    maxCompetitorsPerLocation: 50,
    retentionDays: 180,
    eventsCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    eventsKeywordSets: 5,
  },
  agency: {
    maxLocations: 50,
    maxCompetitorsPerLocation: 200,
    retentionDays: 365,
    eventsCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    eventsKeywordSets: 5,
  },
}

export function getTierFromPriceId(priceId: string | null | undefined): SubscriptionTier {
  if (!priceId) {
    return "free"
  }
  const starter = process.env.STRIPE_PRICE_ID_STARTER
  const pro = process.env.STRIPE_PRICE_ID_PRO
  const agency = process.env.STRIPE_PRICE_ID_AGENCY

  if (starter && priceId === starter) {
    return "starter"
  }
  if (pro && priceId === pro) {
    return "pro"
  }
  if (agency && priceId === agency) {
    return "agency"
  }
  return "free"
}
