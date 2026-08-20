// Tier guardrails for pipeline + UI. Backed by TIER_LIMITS from tiers.ts.

import { TIER_LIMITS, asSubscriptionTier, type SubscriptionTier } from "./tiers"
import { isTrialing } from "./trial"

// ---------------------------------------------------------------------------
// ALT-687 — locations and competitors are PURCHASED QUANTITIES, not tier caps
// ---------------------------------------------------------------------------
// The plan includes some; anything beyond is bought as a Stripe subscription-item quantity and
// mirrored onto organizations.locations_purchased / competitors_purchased by the webhook.
//
//     effective cap = TIER_LIMITS[tier].included* + org.*_purchased
//
// Resolve through these two functions. Reading `includedLocations` or
// `includedCompetitorsPerLocation` directly gives the INCLUDED count and silently under-counts a
// customer who has paid for more. The fields were renamed from `maxLocations` /
// `maxCompetitorsPerLocation` precisely so that a stale read fails to compile rather than
// quietly refusing a paying customer the thing they bought.
//
// The purchased fields are OPTIONAL on the input type on purpose: a caller whose select omits
// them behaves exactly as before the change (purchased = 0). That is what makes this safe to
// ship ahead of the Stripe work in ALT-670.

export type Allowance = {
  /** Included in the plan. */
  included: number
  /** Bought on top, as a Stripe item quantity. */
  purchased: number
  /** The number to actually enforce. */
  total: number
}

export type QuantityOrg = {
  /** Nullable on purpose: asSubscriptionTier degrades null/unknown to `entry`, the SMALLEST
   *  allowance, so a bad read can never widen a cap. */
  subscription_tier: string | null
  locations_purchased?: number | null
  competitors_purchased?: number | null
}

/** Non-negative integer, defaulting to 0. A negative or junk value must never widen a cap. */
function purchased(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

export function resolveLocationAllowance(org: QuantityOrg): Allowance {
  const included = TIER_LIMITS[asSubscriptionTier(org.subscription_tier)].includedLocations
  const bought = purchased(org.locations_purchased)
  return { included, purchased: bought, total: included + bought }
}

export function resolveCompetitorAllowance(org: QuantityOrg): Allowance {
  const included =
    TIER_LIMITS[asSubscriptionTier(org.subscription_tier)].includedCompetitorsPerLocation
  const bought = purchased(org.competitors_purchased)
  return { included, purchased: bought, total: included + bought }
}

export function ensureLocationLimit(org: QuantityOrg, currentCount: number): void {
  const { total } = resolveLocationAllowance(org)
  if (currentCount >= total) {
    throw new Error(
      total === 0
        ? "This plan does not include any locations."
        : `You have ${total} location${total === 1 ? "" : "s"} on your plan. Add another to your subscription to track more.`
    )
  }
}

// Explicit rule (trial-tier v2 · Batch 5): a trial covers ONE location, no
// matter what the tier limits say — stated here so a future change to
// maxLocations can't silently open multi-location trials. Paid orgs fall
// through to the per-tier limit.
//
// DEMO EXCEPTION (Bryan, 2026-07-02): org_kind="demo" orgs (admin-built
// showcases — never billed, never emailed) are exempt from BOTH the trial
// one-location rule and the tier cap, so demos can stage multi-location
// stories freely. Real orgs are unaffected; callers that don't select
// org_kind simply keep the strict behavior.
//
// SOFT-DELETE (2026-08-10): a deleted org must not GROW, so deleted_at is checked ahead of
// everything else, including the demo exemption, which otherwise returns before any gate runs.
// This is a second line behind lib/auth/org-access.ts: server actions resolve the org inline and
// never pass through the (dashboard) layout's deleted_at gate, so the add-location action is
// reachable on a deleted org. Optional on purpose: a caller whose select omits deleted_at keeps
// the previous behavior rather than throwing on an absent field.
export function ensureCanAddLocation(
  org: {
    subscription_tier: string
    trial_ends_at: string | null
    payment_state?: string | null
    org_kind?: string | null
    deleted_at?: string | null
    // ALT-687 — passed through to resolveLocationAllowance. Optional, so a caller whose select
    // omits it keeps the pre-change behaviour of "included only".
    locations_purchased?: number | null
  },
  currentCount: number
): void {
  if (org.deleted_at) {
    throw new Error("This organization is no longer active.")
  }
  if (org.org_kind === "demo") return
  if (currentCount >= 1 && isTrialing(org)) {
    throw new Error(
      "Trials cover one location. Convert to a paid plan to add more."
    )
  }
  ensureLocationLimit(org, currentCount)
}

// Non-throwing mirror of ensureCanAddLocation — for UI that branches between the
// add form and the "plan full" decision screen without try/catch at the call site.
export function canAddLocationHere(
  org: {
    subscription_tier: string
    trial_ends_at: string | null
    payment_state?: string | null
    org_kind?: string | null
    deleted_at?: string | null
    // ALT-687 — passed through to resolveLocationAllowance. Optional, so a caller whose select
    // omits it keeps the pre-change behaviour of "included only".
    locations_purchased?: number | null
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

export function ensureCompetitorLimit(org: QuantityOrg, currentCount: number): void {
  const { total } = resolveCompetitorAllowance(org)
  if (currentCount >= total) {
    throw new Error(
      total === 0
        ? "This plan does not include competitor tracking."
        : `You're watching ${total} competitor${total === 1 ? "" : "s"}, the most your plan covers. Add another to your subscription to watch more.`
    )
  }
}

// ---------------------------------------------------------------------------
// Competitor swap cooldown (ALT-195, rule revised 2026-08-20)
// ---------------------------------------------------------------------------
// A swap is a remove + add, gated location-wide (NOT per slot), and always anchored on
// the REMOVAL: the swap-OUT half. No migration — the record lives in competitor metadata
// (see readSwapHistory).
//
// ALT-261: anchor on a REMOVAL, never on adds. Onboarding auto-approves the initial
// competitor set (adds, status "approved", never "ignored"), so adds must not start the
// window: an operator who just accepted the auto-picks can still swap during their trial.
// (Don't "reconcile" this by also reading competitors.created_at — that would start the
// window at onboarding and re-introduce the exact bug ALT-261 fixed.)
//
// Adding to fill an EMPTY slot (still under the plan's competitor count) is not a swap
// and isn't gated here — the caller only consults this when the set is full, so
// removing-to-make-room then re-adding is what the rule governs.

// TWO-PART RULE (Bryan, 2026-08-20), replacing the flat 1-per-30-days:
//
//   TRIAL  — TRIAL_COMPETITOR_SWAPS swaps total, with NO waiting period between them.
//            Onboarding auto-approves a discovered set, so the operator needs to be able
//            to correct a bad auto-pick immediately, not a month later.
//   PAID   — one swap per COMPETITOR_SWAP_COOLDOWN_DAYS, measured from the last swap.
//
// At the trial→paid boundary the interval simply runs from the most recent swap, whenever
// it happened. Converting does not hand out a fresh swap, and the trial allowance does not
// carry over. One sentence to explain: "two changes while you're trialing, then one a week."
//
// WHY 7 DAYS AND NOT 30: the anti-arbitrage job here is stopping a 3-competitor plan from
// being used to watch 5. The primary defence is the per-competitor add-on price, not the
// lockout: rotating slots to dodge it saves the operator ~$30/mo in exchange for a weekly
// manual chore and gappy, non-comparable data. 30 days was mostly taxing legitimate
// correction. See the KNOWN GAP note on readSwapHistory before widening this further.
export const COMPETITOR_SWAP_COOLDOWN_DAYS = 7
export const TRIAL_COMPETITOR_SWAPS = 2
const DAY_MS = 24 * 60 * 60 * 1000

export type SwapAllowance = {
  /** True when another swap is blocked right now. */
  locked: boolean
  /** ISO timestamp the interval clears. Null when unlocked OR when locked for a
   *  reason a clock cannot clear (a spent trial allowance clears on conversion). */
  unlocksAt: string | null
  /** Whole days until the interval clears (min 1 so we never say "0 days"). 0 when unlocked. */
  daysRemaining: number
  /** Swaps left in the trial allowance; null when the org is not trialing. */
  trialSwapsRemaining: number | null
  reason: "unlocked" | "cooldown" | "trial_exhausted"
}

/** What the competitor rows for one location say about its swap history. */
export type SwapHistory = {
  /** Most recent swap-out moment (ISO), or null if there has never been one. */
  lastSwapAt: string | null
  /** Total swap-outs on record for the location. */
  swapsUsed: number
}

type SwapHistoryRow = {
  updated_at?: string | null
  is_active?: boolean | null
  metadata?: unknown
}

// Reduce a location's competitor rows to its swap history. Pure, so both the page read and
// the server action share one definition instead of the two copies this replaces.
//
// The durable record is `metadata.swapHistory`, an append-only array of ISO timestamps
// stamped on each removal. It lives on the competitor row because add-competitor preserves
// unknown metadata keys when it re-approves an existing row, so the history survives a
// remove → re-add cycle.
//
// LEGACY FALLBACK: rows predating the stamp have no array, so an inactive row whose status
// is "ignored" contributes its updated_at as a single removal. That is the old, less exact
// signal (any write to the row moves updated_at), kept only so the interval rule does not
// regress to "never swapped" for existing orgs. Only consulted when the array is absent.
//
// KNOWN GAP, deliberately not closed here: removal is a soft delete (is_active=false) and
// re-adding the same place restores the row WITH its accumulated snapshots. So rotating a
// slot costs the operator continuity but loses no history, which leaves the watch-5-on-a-3
// loop open in principle. Closing it properly means capping DISTINCT competitors observed
// per rolling window, not lengthening the interval. Filed as a follow-up rather than guessed
// at, because nothing in the data shows anyone doing it yet.
export function readSwapHistory(rows: readonly SwapHistoryRow[] | null | undefined): SwapHistory {
  const stamps: string[] = []
  for (const row of rows ?? []) {
    const metadata = (row.metadata ?? null) as Record<string, unknown> | null
    const history = metadata?.swapHistory
    const entries = Array.isArray(history) ? history.filter((v): v is string => typeof v === "string") : []
    if (entries.length > 0) {
      stamps.push(...entries)
      continue
    }
    if (row.is_active === false && metadata?.status === "ignored" && typeof row.updated_at === "string") {
      stamps.push(row.updated_at)
    }
  }
  let lastSwapAt: string | null = null
  for (const ts of stamps) if (!lastSwapAt || ts > lastSwapAt) lastSwapAt = ts
  return { lastSwapAt, swapsUsed: stamps.length }
}

// Mirrors the generated `Json` type without importing database types into a pure billing
// module. The competitor metadata column really is jsonb, so treating a read as JSON is a
// statement of fact rather than a convenience cast.
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject
type JsonObject = { [key: string]: JsonValue | undefined }

/** Append one swap-out timestamp to a competitor row's metadata. Returns the metadata to
 *  write, leaving every other key alone. */
export function stampSwapOut(metadata: unknown, at: string, status: string = "ignored"): JsonObject {
  const base = (metadata ?? null) as JsonObject | null
  const prior = Array.isArray(base?.swapHistory)
    ? (base.swapHistory as JsonValue[]).filter((v): v is string => typeof v === "string")
    : []
  return { ...base, status, swapHistory: [...prior, at] }
}

/** Pure: does this location get another swap right now?
 *
 *  A trialing org spends from a fixed allowance and never waits. A paid org waits out the
 *  interval from its last swap. Callers must still apply the at-cap test: removing a
 *  competitor while BELOW the plan limit frees a slot and is not a swap (ALT-261). */
export function computeSwapAllowance(
  history: SwapHistory,
  opts: { trialing: boolean },
  now: Date = new Date()
): SwapAllowance {
  if (opts.trialing) {
    const remaining = Math.max(0, TRIAL_COMPETITOR_SWAPS - history.swapsUsed)
    if (remaining > 0) {
      return { locked: false, unlocksAt: null, daysRemaining: 0, trialSwapsRemaining: remaining, reason: "unlocked" }
    }
    // No clock can clear this one: the allowance refreshes when they subscribe.
    return {
      locked: true,
      unlocksAt: null,
      daysRemaining: 0,
      trialSwapsRemaining: 0,
      reason: "trial_exhausted",
    }
  }

  const unlocked: SwapAllowance = {
    locked: false,
    unlocksAt: null,
    daysRemaining: 0,
    trialSwapsRemaining: null,
    reason: "unlocked",
  }
  if (!history.lastSwapAt) return unlocked
  const last = new Date(history.lastSwapAt).getTime()
  if (Number.isNaN(last)) return unlocked
  const unlocks = last + COMPETITOR_SWAP_COOLDOWN_DAYS * DAY_MS
  const remainingMs = unlocks - now.getTime()
  if (remainingMs <= 0) return unlocked
  return {
    locked: true,
    unlocksAt: new Date(unlocks).toISOString(),
    daysRemaining: Math.max(1, Math.ceil(remainingMs / DAY_MS)),
    trialSwapsRemaining: null,
    reason: "cooldown",
  }
}

/** The one place the rule is worded for an operator. Both the page copy and the blocked
 *  action message come from here, so they cannot drift apart. */
export function swapLockedMessage(allowance: SwapAllowance): string {
  if (allowance.reason === "trial_exhausted") {
    return (
      `You've used both competitor changes in your trial. ` +
      `Subscribe to keep changing your set, then it's one change a week.`
    )
  }
  const days = allowance.daysRemaining
  return (
    `You can change a competitor once every ${COMPETITOR_SWAP_COOLDOWN_DAYS} days. ` +
    `Your set is locked for ${days} more day${days === 1 ? "" : "s"}.`
  )
}

/** Throwing guard for the server actions so a locked operator can't bypass the disabled
 *  UI by invoking the action directly. No-op when unlocked. */
export function ensureSwapAllowed(allowance: SwapAllowance): void {
  if (allowance.locked) throw new Error(swapLockedMessage(allowance))
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

// ---------------------------------------------------------------------------
// Run cadence (ALT-683) — the gate and the label, from ONE field
// ---------------------------------------------------------------------------
// `runCadence` decides whether a location runs at all on a given day, which is what makes a
// Starter location weekly and a Standard location daily. That difference IS the price gap, so
// the predicate and the customer-facing label both live here rather than being re-derived at
// each call site. Three copies of `cadence === "weekly" ? ... : ...` across the billing tiles
// is how the old pair of fields drifted apart in the first place.

/** Does this location run today? Pure, so the gate the cron applies is the gate a test can
 *  assert. A weekly location runs Mondays.
 *
 *  `forced` covers an explicitly requested single location: a deliberate ops action, not the
 *  nightly sweep deciding whose turn it is.
 *
 *  ALT-688 — THERE IS NO TRIAL BYPASS, deliberately. A trial used to run daily on any plan, on
 *  the reasoning that an evaluator who sees data move only on Mondays churns. That was never
 *  costed, and under the current price sheet it is backwards: Starter IS weekly and is
 *  self-serve, so a trial showing daily briefs misrepresents the product and then takes the
 *  behaviour away on the day they pay. The worst possible shape. A trial inherits the cadence of
 *  the plan it is trialling; the honest demo is the real one.
 *
 *  Do not re-add an `inActiveTrial` escape here. If a DEMO org needs to look livelier than its
 *  plan, that is an explicit demo rule (org_kind), not a trial rule. */
export function isRunDueToday(
  cadence: "weekly" | "daily",
  dayOfWeek: number,
  opts: { forced?: boolean } = {}
): boolean {
  if (opts.forced) return true
  if (cadence === "daily") return true
  return dayOfWeek === 1
}

/** The operator-facing label for a tier's brief cadence. The billing tiles must not phrase
 *  this themselves: the promise on the tile and the behaviour in the cron have to come from
 *  the same field, and a test pins that they do. */
export function runCadenceLabel(tier: SubscriptionTier): "Weekly briefings" | "Daily briefings" {
  return TIER_LIMITS[tier].runCadence === "weekly" ? "Weekly briefings" : "Daily briefings"
}
