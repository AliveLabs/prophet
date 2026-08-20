// ---------------------------------------------------------------------------
// Cost to serve, per TIER (ALT-668)
//
// We are about to buy traffic onto three price points that have never been checked against what
// the customers on them cost to serve. This module is the check: it takes a tier, reads the limits
// that are ACTUALLY ENFORCED, and runs them through the bottom-up cost model.
//
// ── Why a tier layer had to exist at all ─────────────────────────────────────────────────────
// `estimateClientCost` takes raw numbers (competitors, platforms, cadence). Nothing connected it
// to `TIER_LIMITS`, so every projection was hand-parameterised, which is how a projection and a
// bill end up describing different systems. That already happened once: on 2026-08-10 SEO was
// found running daily for every location while every tier declared it weekly and the model priced
// it weekly, about 7x the modelled rate on the largest vendor line. This module closes that gap
// from the other side by deriving the inputs from the tier definition instead of restating them.
//
// ── ENFORCEMENT AUDIT, 2026-08-19. Read this before trusting any number here ─────────────────
// A cost model may only use knobs the pipeline actually honours. Audited every field of
// `TierLimits` for readers outside tiers.ts and cost-model.ts:
//
//   ENFORCED, and used below:
//     includedLocations, includedCompetitorsPerLocation, ownSocialNetworkLimit, runCadence,
//     seoCadence (via isSeoDue in app/api/cron/daily), seoTrackedKeywords,
//     seoRankedKeywordsLimit, seoIntersectionEnabled/Limit (all in lib/jobs/pipelines/visibility.ts)
//
//   DEAD FIELDS — zero readers anywhere. They must NOT be used to price anything:
//     `eventsKeywordSets`
//     `ensureTrackedKeywordLimit()` also has no callers, so the tracked-keyword cap is not
//     enforced at the point a keyword is added. Cost is still bounded, because visibility.ts
//     slices to `getSeoTrackedKeywordsLimit` before pulling — the gap is a UX cap, not a spend leak.
//
//   DELETED 2026-08-20 (ALT-683) — do not restore these to "match the pricing brief":
//     `briefingCadence`  sat in the SOLD block and enforced nothing. `eventsCadence`, filed under
//        "internal pipeline tuning (not sold)", was the field that actually gated the run. They are
//        now one honestly-named `runCadence`, with a pure `isRunDueToday` predicate and a test
//        tying it to the billing tiles that promise it (tests/unit/billing/run-cadence.test.ts).
//     `seoLabsCadence`, `seoSerpCadence`  superseded by `seoCadence`, getters had zero callers.
//     `contentRefreshCadence`  decorative: content refresh is gated by `isWeeklyFullBuildDay`,
//        which is not tier-dependent at all, so the field implied a per-tier behaviour that did
//        not exist.
//
// That audit matters because the dead SEO pair is exactly what an earlier reading of this problem
// priced from: `seoLabsCadence` said the top tier was "daily", which would make its search volume
// roughly 28x the mid tier. The ENFORCED field says `biweekly`. The real multiplier is derived
// below and it is smaller, for a reason nobody would guess from reading TIER_LIMITS top to bottom.
//
// The rule this keeps re-teaching: a field that DESCRIBES the system without CONTROLLING it will
// eventually be priced or gated from. Same family as the metric-must-not-share-predicate rule.
//
// ── Are the SEO limits per location or per organization? PER LOCATION ────────────────────────
// The daily cron loops over locations, gates `seoDue` per location, and enqueues `visibility` per
// location; the pipeline then applies `getSeoTrackedKeywordsLimit(tier)` inside that per-location
// run. So a 3-location top-tier org pulls the full keyword allowance three times over. That was
// the single biggest open swing factor on the ticket, and this is the answer.
//
// ── WHAT THIS DOES NOT INCLUDE ───────────────────────────────────────────────────────────────
// Variable data-acquisition cost only. It EXCLUDES the fixed floors (the Data365 subscription,
// Supabase, Vercel, Anthropic minimums, Resend) which dominate real COGS at low subscriber
// counts. Use `fixedFloorPerSubscriberUsd` to fold those in; the margin fields here are
// deliberately labelled "variable" so nobody quotes them as gross margin.
// ---------------------------------------------------------------------------

import { estimateClientCost, RUNS_PER_MONTH, type ClientCostEstimate, type CostCadence } from "./cost-model"
import { TIER_LIMITS, TIER_PRICING, type SubscriptionTier } from "./tiers"

/** A tier you can actually be billed for. `suspended` has no price and no limits to cost. */
export type PricedTier = Exclude<SubscriptionTier, "suspended">

/**
 * MEASURED Anthropic cost per brief, from the spend-cap sizing work.
 *
 * This matters more than anything else in this file. `cost-model.ts` models the brief as 10 Claude
 * calls at $0.024, i.e. $0.24, and the real observed figure is **$1.77 average / $2.12 p95** — about
 * 7x higher. The model's figure predates adaptive thinking and 32k producer budgets; the observed
 * one is what the Anthropic console actually billed.
 *
 * On the top tier the difference decides the verdict: 30 briefs x 3 locations at $1.77 is $159/mo of
 * Claude alone against a $499 price. Use the observed number, not the modelled one, and treat the
 * modelled Claude line as superseded.
 */
export const OBSERVED_USD_PER_BRIEF = { avg: 1.77, p95: 2.12 } as const

/** Verdict on a price point. Bands are a PROPOSAL, not a measured fact — see below. */
export type TierCostVerdict = "healthy" | "thin" | "underwater"

/**
 * Variable-margin bands.
 *
 * These are a judgement call and Bryan's to overrule. The reasoning: variable data cost is only
 * part of COGS, and the fixed floors land on top of it, so a tier that already spends half its
 * price on variable cost has no room left. Chosen deliberately conservative for that reason
 * rather than copied from a generic SaaS "80% gross margin" rule, which is measuring a different
 * thing (that number is post-everything, this one is pre-fixed-cost).
 */
export const VARIABLE_MARGIN_BANDS = {
  /** At or above this variable margin, the price point has room for fixed costs and support. */
  healthy: 0.75,
  /** Below this, variable cost alone is eating half the price. */
  underwater: 0.5,
} as const

export type TierCostEstimate = {
  tier: PricedTier
  priceUsd: number
  /** Inputs, all derived from enforced limits so they can be checked against the tier table. */
  inputs: {
    locations: number
    competitorsPerLocation: number
    ownSocialNetworks: number
    briefCadence: CostCadence
    seoCadence: CostCadence
    briefRunsPerMonth: number
    seoRunsPerMonth: number
  }
  /** One location's variable cost. */
  perLocationUsd: number
  /** perLocationUsd × locations. This is the number to compare against the price. */
  totalVariableUsd: number
  bySourceUsd: Record<string, number>
  /** Price minus variable cost, as a share of price. NOT gross margin: fixed floors excluded. */
  variableMarginPct: number
  verdict: TierCostVerdict
  notes: string[]
}

/** The brief cadence a tier's `runCadence` produces. Same field the cron gates on. */
function briefCadenceFor(tier: PricedTier): CostCadence {
  return TIER_LIMITS[tier].runCadence
}

function verdictFor(variableMarginPct: number): TierCostVerdict {
  if (variableMarginPct >= VARIABLE_MARGIN_BANDS.healthy * 100) return "healthy"
  if (variableMarginPct < VARIABLE_MARGIN_BANDS.underwater * 100) return "underwater"
  return "thin"
}

/**
 * Cost to serve ONE customer on a tier, at that tier's enforced limits.
 *
 * At the limits on purpose, not at average usage: the account that decides whether a price is
 * real is the one using everything it paid for. A top-tier customer at 3 locations and 10
 * competitors each is the worst case AND a completely legitimate customer.
 */
export function estimateTierCost(
  tier: PricedTier,
  opts: {
    cadence?: "monthly" | "annual"
    dormantFraction?: number
    /** Anthropic $/brief to use in place of the model's stale figure. Defaults to the MEASURED
     *  average; pass `OBSERVED_USD_PER_BRIEF.p95` for the worst-case account. Pass `null` to see
     *  the raw modelled number (only useful for comparing against the old projection). */
    usdPerBrief?: number | null
    /** ALT-687 — how many locations to cost. Defaults to the tier's INCLUDED count, which is 1 on
     *  every tier now. Pass a higher number to cost an account that has purchased more, which is
     *  the question the per-location price sheet actually raises ("what does a 4-location Standard
     *  account cost to serve?"). Note the PRICE stays the single-unit price, so compare
     *  perLocationUsd rather than variableMarginPct when you override this. */
    locations?: number
  } = {},
): TierCostEstimate {
  const limits = TIER_LIMITS[tier]
  const briefCadence = briefCadenceFor(tier)
  const seoCadence = limits.seoCadence as CostCadence

  // Annual is billed at a discount, so the monthly-equivalent price is the honest denominator.
  const priceUsd =
    opts.cadence === "annual"
      ? TIER_PRICING[tier].annualEffectiveMonthly
      : TIER_PRICING[tier].monthly

  const perLocation: ClientCostEstimate = estimateClientCost({
    competitors: limits.includedCompetitorsPerLocation,
    platforms: limits.ownSocialNetworkLimit,
    cadence: briefCadence,
    seoCadence,
    dormantFraction: opts.dormantFraction,
    monthlyPriceUsd: priceUsd,
  })

  const locations = Math.max(opts.locations ?? limits.includedLocations, 0)

  // Replace the modelled Claude line with the measured one (see OBSERVED_USD_PER_BRIEF). Done here
  // rather than by editing cost-model's UNIT_PRICES because that file's contract is "verified
  // provider unit prices x code volumes", and $1.77/brief is neither: it is an observed total that
  // already bundles thinking tokens, retries and cache behaviour across ten calls.
  const usdPerBrief = opts.usdPerBrief === undefined ? OBSERVED_USD_PER_BRIEF.avg : opts.usdPerBrief
  const briefRuns = RUNS_PER_MONTH[briefCadence]
  const perLocationSources = { ...perLocation.bySourceUsd }
  let perLocationUsd = perLocation.variableTotalUsd
  if (usdPerBrief != null) {
    const observedClaude = round(usdPerBrief * briefRuns)
    perLocationUsd = round(perLocationUsd - perLocationSources.claude + observedClaude)
    perLocationSources.claude = observedClaude
  }

  const totalVariableUsd = round(perLocationUsd * locations)
  const bySourceUsd = Object.fromEntries(
    Object.entries(perLocationSources).map(([k, v]) => [k, round(v * locations)]),
  )
  const variableMarginPct =
    priceUsd > 0 ? round(((priceUsd - totalVariableUsd) / priceUsd) * 100) : 0

  const notes = [...perLocation.notes]
  if (usdPerBrief != null) {
    notes.push(
      `Claude line uses the MEASURED $${usdPerBrief}/brief x ${briefRuns} briefs, not the model's ~$0.24/brief (which predates adaptive thinking and 32k producer budgets and understates it ~7x).`,
    )
  }
  if (locations > 1) {
    notes.push(
      `Multiplied by ${locations} locations: every per-location pull (SEO keywords, competitor social, photos, menus) runs once PER LOCATION — verified, the daily cron loops locations and gates SEO per location.`,
    )
  }

  return {
    tier,
    priceUsd,
    inputs: {
      locations,
      competitorsPerLocation: limits.includedCompetitorsPerLocation,
      ownSocialNetworks: limits.ownSocialNetworkLimit,
      briefCadence,
      seoCadence,
      briefRunsPerMonth: RUNS_PER_MONTH[briefCadence],
      seoRunsPerMonth: RUNS_PER_MONTH[seoCadence],
    },
    perLocationUsd,
    totalVariableUsd,
    bySourceUsd,
    variableMarginPct,
    verdict: verdictFor(variableMarginPct),
    notes,
  }
}

/**
 * How much of a tier's price is left for fixed costs, per subscriber.
 *
 * The model's own warning is that fixed floors dominate COGS until there are enough subscribers to
 * spread them over. This turns that warning into a number: at `subscribers`, each one absorbs
 * `fixedMonthlyUsd / subscribers`, and this reports whether the tier still clears.
 */
export function fixedFloorPerSubscriberUsd(
  fixedMonthlyUsd: number,
  subscribers: number,
): number | null {
  if (subscribers <= 0) return null
  return round(fixedMonthlyUsd / subscribers)
}

/**
 * The relative provider-volume load of one tier against another, on the two knobs that multiply.
 *
 * This is the "is $499 a real price" question in its sharpest form, and it is the number an
 * earlier pass got wrong by pricing off the dead `seoLabsCadence` field. Returns the SEO-volume
 * multiple (keywords × locations × cadence) and the entity multiple (competitors × locations),
 * alongside the price multiple, so all three can be compared directly.
 */
export function tierLoadMultiple(
  tier: PricedTier,
  against: PricedTier,
): { seoVolume: number; entities: number; price: number; briefs: number } {
  const load = (t: PricedTier) => {
    const l = TIER_LIMITS[t]
    return {
      seo: l.seoTrackedKeywords * l.includedLocations * RUNS_PER_MONTH[l.seoCadence as CostCadence],
      entities: (l.includedCompetitorsPerLocation + 1) * l.includedLocations,
      briefs: RUNS_PER_MONTH[briefCadenceFor(t)] * l.includedLocations,
    }
  }
  const a = load(tier)
  const b = load(against)
  return {
    seoVolume: b.seo > 0 ? round(a.seo / b.seo) : 0,
    entities: b.entities > 0 ? round(a.entities / b.entities) : 0,
    briefs: b.briefs > 0 ? round(a.briefs / b.briefs) : 0,
    price: round(TIER_PRICING[tier].monthly / TIER_PRICING[against].monthly),
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
