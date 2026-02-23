export type SubscriptionTier = "free" | "starter" | "pro" | "agency"

export type TierLimits = {
  maxLocations: number
  maxCompetitorsPerLocation: number
  retentionDays: number
  // Events Intelligence limits
  eventsCadence: "weekly" | "daily"
  eventsQueriesPerRun: number
  eventsMaxDepth: number
  eventsKeywordSets: number
  // SEO Search Intelligence limits
  seoTrackedKeywords: number
  seoLabsCadence: "weekly" | "daily"
  seoSerpCadence: "weekly" | "daily"
  seoRankedKeywordsLimit: number
  seoIntersectionEnabled: boolean
  seoIntersectionLimit: number
  seoAdsEnabled: boolean
  // Content & Menu Intelligence limits
  contentPagesPerRun: number
  contentRefreshCadence: "weekly" | "daily"
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
    seoTrackedKeywords: 10,
    seoLabsCadence: "weekly",
    seoSerpCadence: "weekly",
    seoRankedKeywordsLimit: 50,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 25,
    seoAdsEnabled: true,
    contentPagesPerRun: 2,
    contentRefreshCadence: "weekly",
  },
  starter: {
    maxLocations: 3,
    maxCompetitorsPerLocation: 15,
    retentionDays: 90,
    eventsCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    eventsKeywordSets: 5,
    seoTrackedKeywords: 25,
    seoLabsCadence: "weekly",
    seoSerpCadence: "weekly",
    seoRankedKeywordsLimit: 50,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 50,
    seoAdsEnabled: true,
    contentPagesPerRun: 3,
    contentRefreshCadence: "weekly",
  },
  pro: {
    maxLocations: 10,
    maxCompetitorsPerLocation: 50,
    retentionDays: 180,
    eventsCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    eventsKeywordSets: 5,
    seoTrackedKeywords: 50,
    seoLabsCadence: "weekly",
    seoSerpCadence: "daily",
    seoRankedKeywordsLimit: 100,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 100,
    seoAdsEnabled: true,
    contentPagesPerRun: 5,
    contentRefreshCadence: "weekly",
  },
  agency: {
    maxLocations: 50,
    maxCompetitorsPerLocation: 200,
    retentionDays: 365,
    eventsCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    eventsKeywordSets: 5,
    seoTrackedKeywords: 200,
    seoLabsCadence: "daily",
    seoSerpCadence: "daily",
    seoRankedKeywordsLimit: 500,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 500,
    seoAdsEnabled: true,
    contentPagesPerRun: 8,
    contentRefreshCadence: "weekly",
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
