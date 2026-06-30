// Tier guardrails for pipeline + UI. Backed by TIER_LIMITS from tiers.ts.

import { TIER_LIMITS, asSubscriptionTier, type SubscriptionTier } from "./tiers"
import { isTrialing } from "./trial"

export function ensureLocationLimit(
  tier: SubscriptionTier,
  currentCount: number
): void {
  const limit = TIER_LIMITS[tier].maxLocations
  if (currentCount >= limit) {
    throw new Error(`Location limit reached for ${tier} tier.`)
  }
}

// Explicit rule (trial-tier v2 · Batch 5): a trial covers ONE location, no
// matter what the tier limits say — stated here so a future change to
// maxLocations can't silently open multi-location trials. Paid orgs fall
// through to the per-tier limit.
export function ensureCanAddLocation(
  org: {
    subscription_tier: string
    trial_ends_at: string | null
    payment_state?: string | null
  },
  currentCount: number
): void {
  if (currentCount >= 1 && isTrialing(org)) {
    throw new Error(
      "Trials cover one location. Convert to a paid plan to add more."
    )
  }
  ensureLocationLimit(asSubscriptionTier(org.subscription_tier), currentCount)
}

// Non-throwing mirror of ensureCanAddLocation — for UI that branches between the
// add form and the "plan full" decision screen without try/catch at the call site.
export function canAddLocationHere(
  org: {
    subscription_tier: string
    trial_ends_at: string | null
    payment_state?: string | null
  },
  currentCount: number
): boolean {
  try {
    ensureCanAddLocation(org, currentCount)
    return true
  } catch {
    return false
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
// Competitor swap cooldown (ALT-195)
// ---------------------------------------------------------------------------
// One swap (remove + add a competitor) per 30 days, location-wide (NOT per slot).
// We derive the cooldown from existing competitor timestamps — no new column /
// migration: the most recent operator add (competitors.created_at) or removal
// (competitors.updated_at when status flips to "ignored") marks the last swap.
// If that moment is within 30 days, the next swap is locked until it clears.
//
// Adding to fill an EMPTY slot (still under the plan's competitor count) is not a
// swap and isn't gated here — the caller only consults this when the set is full,
// so removing-to-make-room then re-adding is what the cooldown governs.

export const COMPETITOR_SWAP_COOLDOWN_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export type SwapCooldown = {
  /** True when a swap happened within the cooldown window and another is blocked. */
  locked: boolean
  /** ISO timestamp the cooldown clears (locked only). */
  unlocksAt: string | null
  /** Whole days remaining until it clears (locked only; min 1 so we never say "0 days"). */
  daysRemaining: number
}

/** Pure: given the most recent swap moment (ISO) and "now", compute lock state.
 *  `lastSwapAt` null/empty ⇒ never swapped ⇒ unlocked. */
export function computeSwapCooldown(
  lastSwapAt: string | null | undefined,
  now: Date = new Date()
): SwapCooldown {
  if (!lastSwapAt) return { locked: false, unlocksAt: null, daysRemaining: 0 }
  const last = new Date(lastSwapAt).getTime()
  if (Number.isNaN(last)) return { locked: false, unlocksAt: null, daysRemaining: 0 }
  const unlocks = last + COMPETITOR_SWAP_COOLDOWN_DAYS * DAY_MS
  const remainingMs = unlocks - now.getTime()
  if (remainingMs <= 0) return { locked: false, unlocksAt: null, daysRemaining: 0 }
  return {
    locked: true,
    unlocksAt: new Date(unlocks).toISOString(),
    daysRemaining: Math.max(1, Math.ceil(remainingMs / DAY_MS)),
  }
}

/** Throwing guard for the add-competitor server action so a locked operator can't
 *  bypass the disabled UI by invoking the action directly. No-op when unlocked. */
export function ensureSwapAllowed(cooldown: SwapCooldown): void {
  if (cooldown.locked) {
    throw new Error(
      `You can swap a competitor once every ${COMPETITOR_SWAP_COOLDOWN_DAYS} days. ` +
        `Your set is locked for ${cooldown.daysRemaining} more day${cooldown.daysRemaining === 1 ? "" : "s"}.`
    )
  }
}

// ---------------------------------------------------------------------------
// Team / multi-user (ALT-218)
// ---------------------------------------------------------------------------
// Inviting additional users is a Tier 2+ capability (mid/top). Tier 1 (entry) and
// the suspended tier are single-operator. A free TRIAL is a trial OF Tier 2, so an
// org that's actively trialing can invite — gate on the EFFECTIVE tier, not the raw
// row. Use these from both the invite UI (canInviteTeamMembers, non-throwing) and the
// future invite server action (ensureCanInviteTeamMember, the bypass-proof guard).

const TEAM_INVITE_TIERS: readonly SubscriptionTier[] = ["mid", "top"] as const

/** Tiers that may invite additional users. */
export function tierAllowsTeamInvites(tier: SubscriptionTier): boolean {
  return TEAM_INVITE_TIERS.includes(tier)
}

/** Non-throwing check for the invite UI. A live Tier-2 trial counts as Tier 2.
 *  Returns false for Tier 1, suspended, and expired/no-access orgs. */
export function canInviteTeamMembers(org: {
  subscription_tier: string
  trial_ends_at: string | null
  payment_state?: string | null
}): boolean {
  // An active trial is a trial OF the mid tier — treat it as mid for this gate.
  if (isTrialing(org)) return true
  return tierAllowsTeamInvites(asSubscriptionTier(org.subscription_tier))
}

/** Throwing guard for the invite server action so a Tier-1 caller can't bypass a
 *  disabled button by invoking the action directly. */
export function ensureCanInviteTeamMember(org: {
  subscription_tier: string
  trial_ends_at: string | null
  payment_state?: string | null
}): void {
  if (!canInviteTeamMembers(org)) {
    throw new Error(
      "Inviting team members is available on Tier 2 and Tier 3. Upgrade your plan to add your team."
    )
  }
}

// ---------------------------------------------------------------------------
// Events Intelligence
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
  return Math.min(TIER_LIMITS[tier].eventsMaxDepth, 20)
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
// SEO Search Intelligence
// ---------------------------------------------------------------------------

export function getSeoTrackedKeywordsLimit(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].seoTrackedKeywords
}

export function getSeoLabsCadence(
  tier: SubscriptionTier
): "weekly" | "daily" {
  return TIER_LIMITS[tier].seoLabsCadence
}

export function getSeoSerpCadence(
  tier: SubscriptionTier
): "weekly" | "daily" {
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

// ---------------------------------------------------------------------------
// Content & Menu Intelligence
// ---------------------------------------------------------------------------

export function getContentMaxPages(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].contentPagesPerRun
}

export function getContentCadence(
  tier: SubscriptionTier
): "weekly" | "daily" {
  return TIER_LIMITS[tier].contentRefreshCadence
}

// ---------------------------------------------------------------------------
// Pricing-brief features (sold on the pricing page)
// ---------------------------------------------------------------------------

export function isApiAccessEnabled(tier: SubscriptionTier): boolean {
  return TIER_LIMITS[tier].apiAccess
}

export function isWhiteLabelEnabled(tier: SubscriptionTier): boolean {
  return TIER_LIMITS[tier].whiteLabelReports
}

export function getPhotoAnalysisDepth(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].photoAnalysisDepth
}

export function getRetentionDays(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].retentionDays
}

export function getCompetitorSocialPlatforms(
  tier: SubscriptionTier
): readonly ("instagram" | "facebook" | "tiktok")[] {
  return TIER_LIMITS[tier].competitorSocialNetworks
}
