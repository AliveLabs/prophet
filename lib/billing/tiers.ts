// Tier definitions for Ticket & Neat per the Apr 2026 pricing brief
// (app/docs/Ticket_Neat_Pricing_Brief_Apr2026.txt). One backend; two brands
// differentiated by organizations.industry_type; same tier prices and feature
// gates per tier across brands. Display names diverge per brand.
//
// Public surface used by the pricing page / upgrade buttons: maxLocations,
// maxCompetitorsPerLocation, socialPlatforms, seoCadence, briefingCadence,
// photoAnalysisDepth, retentionDays, whiteLabelReports, apiAccess, support.
// Everything else (eventsQueriesPerRun, seoTrackedKeywords, etc.) is an
// internal pipeline-tuning knob not sold on the pricing page.

import type { IndustryType } from "@/lib/verticals"

export type SubscriptionTier =
  | "free"
  | "entry"
  | "mid"
  | "top"
  | "suspended"

export type Cadence = "monthly" | "annual"

export type SocialPlatform = "instagram" | "facebook" | "tiktok"

export type SeoCadence = "weekly" | "biweekly" // biweekly = 2x / week
export type BriefingCadence = "weekly_digest" | "daily" | "daily_priority"
export type SupportTier = "email" | "email_chat" | "dedicated"

export type TierLimits = {
  // --- Brief-visible fields (pricing page) -------------------------------
  maxLocations: number
  maxCompetitorsPerLocation: number
  socialPlatforms: readonly SocialPlatform[]
  seoCadence: SeoCadence
  briefingCadence: BriefingCadence
  photoAnalysisDepth: number
  retentionDays: number
  whiteLabelReports: boolean
  apiAccess: boolean
  support: SupportTier

  // --- Internal pipeline tuning (not sold) -------------------------------
  eventsCadence: "weekly" | "daily"
  eventsQueriesPerRun: number
  eventsMaxDepth: number
  eventsKeywordSets: number
  seoTrackedKeywords: number
  seoLabsCadence: "weekly" | "daily"
  seoSerpCadence: "weekly" | "daily"
  seoRankedKeywordsLimit: number
  seoIntersectionEnabled: boolean
  seoIntersectionLimit: number
  seoAdsEnabled: boolean
  contentPagesPerRun: number
  contentRefreshCadence: "weekly" | "daily"
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    maxLocations: 1,
    maxCompetitorsPerLocation: 3,
    socialPlatforms: ["instagram"] as const,
    seoCadence: "weekly",
    briefingCadence: "weekly_digest",
    photoAnalysisDepth: 10,
    retentionDays: 30,
    whiteLabelReports: false,
    apiAccess: false,
    support: "email",
    eventsCadence: "weekly",
    eventsQueriesPerRun: 1,
    eventsMaxDepth: 10,
    eventsKeywordSets: 0,
    seoTrackedKeywords: 10,
    seoLabsCadence: "weekly",
    seoSerpCadence: "weekly",
    seoRankedKeywordsLimit: 50,
    seoIntersectionEnabled: false,
    seoIntersectionLimit: 0,
    seoAdsEnabled: false,
    contentPagesPerRun: 2,
    contentRefreshCadence: "weekly",
  },
  entry: {
    maxLocations: 1,
    maxCompetitorsPerLocation: 3,
    socialPlatforms: ["instagram"] as const,
    seoCadence: "weekly",
    briefingCadence: "weekly_digest",
    photoAnalysisDepth: 10,
    retentionDays: 30,
    whiteLabelReports: false,
    apiAccess: false,
    support: "email",
    eventsCadence: "weekly",
    eventsQueriesPerRun: 1,
    eventsMaxDepth: 10,
    eventsKeywordSets: 2,
    seoTrackedKeywords: 15,
    seoLabsCadence: "weekly",
    seoSerpCadence: "weekly",
    seoRankedKeywordsLimit: 50,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 25,
    seoAdsEnabled: false,
    contentPagesPerRun: 3,
    contentRefreshCadence: "weekly",
  },
  mid: {
    maxLocations: 1,
    maxCompetitorsPerLocation: 5,
    socialPlatforms: ["instagram", "facebook", "tiktok"] as const,
    seoCadence: "weekly",
    briefingCadence: "daily",
    photoAnalysisDepth: 30,
    retentionDays: 90,
    whiteLabelReports: true,
    apiAccess: false,
    support: "email_chat",
    eventsCadence: "daily",
    eventsQueriesPerRun: 2,
    eventsMaxDepth: 10,
    eventsKeywordSets: 5,
    seoTrackedKeywords: 50,
    seoLabsCadence: "weekly",
    seoSerpCadence: "weekly",
    seoRankedKeywordsLimit: 100,
    seoIntersectionEnabled: true,
    seoIntersectionLimit: 100,
    seoAdsEnabled: true,
    contentPagesPerRun: 5,
    contentRefreshCadence: "weekly",
  },
  top: {
    maxLocations: 3,
    maxCompetitorsPerLocation: 10,
    socialPlatforms: ["instagram", "facebook", "tiktok"] as const,
    seoCadence: "biweekly",
    briefingCadence: "daily_priority",
    photoAnalysisDepth: 30,
    retentionDays: 365,
    whiteLabelReports: true,
    apiAccess: true,
    support: "dedicated",
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
  suspended: {
    maxLocations: 0,
    maxCompetitorsPerLocation: 0,
    socialPlatforms: [] as const,
    seoCadence: "weekly",
    briefingCadence: "weekly_digest",
    photoAnalysisDepth: 0,
    retentionDays: 0,
    whiteLabelReports: false,
    apiAccess: false,
    support: "email",
    eventsCadence: "weekly",
    eventsQueriesPerRun: 0,
    eventsMaxDepth: 0,
    eventsKeywordSets: 0,
    seoTrackedKeywords: 0,
    seoLabsCadence: "weekly",
    seoSerpCadence: "weekly",
    seoRankedKeywordsLimit: 0,
    seoIntersectionEnabled: false,
    seoIntersectionLimit: 0,
    seoAdsEnabled: false,
    contentPagesPerRun: 0,
    contentRefreshCadence: "weekly",
  },
}

// Per-brand tier display names. Drives the billing page, upgrade buttons,
// trial gate, emails, and any admin copy that shows a customer what they bought.
const DISPLAY_NAMES: Record<IndustryType, Record<SubscriptionTier, string>> = {
  restaurant: {
    free: "Free",
    entry: "Table",
    mid: "Shift",
    top: "House",
    suspended: "Suspended",
  },
  liquor_store: {
    free: "Free",
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

// Public dollar figures for UI. Monthly billed monthly. Annual billed
// annually at 20% off (brief section 3/4). `annualEffectiveMonthly` =
// annual / 12, used beside the annual price.
export const TIER_PRICING: Record<
  Exclude<SubscriptionTier, "free" | "suspended">,
  { monthly: number; annual: number; annualEffectiveMonthly: number }
> = {
  entry: { monthly: 149, annual: 1428, annualEffectiveMonthly: 119 },
  mid: { monthly: 299, annual: 2868, annualEffectiveMonthly: 239 },
  top: { monthly: 499, annual: 4788, annualEffectiveMonthly: 399 },
}

// Narrow guard for values read out of the DB.
export function asSubscriptionTier(value: unknown): SubscriptionTier {
  if (
    value === "free" ||
    value === "entry" ||
    value === "mid" ||
    value === "top" ||
    value === "suspended"
  ) {
    return value
  }
  return "free"
}
