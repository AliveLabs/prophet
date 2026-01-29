export type SubscriptionTier = "free" | "starter" | "pro" | "agency"

export const TIER_LIMITS: Record<
  SubscriptionTier,
  { maxLocations: number; maxCompetitorsPerLocation: number; retentionDays: number }
> = {
  free: { maxLocations: 1, maxCompetitorsPerLocation: 5, retentionDays: 30 },
  starter: { maxLocations: 3, maxCompetitorsPerLocation: 15, retentionDays: 90 },
  pro: { maxLocations: 10, maxCompetitorsPerLocation: 50, retentionDays: 180 },
  agency: { maxLocations: 50, maxCompetitorsPerLocation: 200, retentionDays: 365 },
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
