// ---------------------------------------------------------------------------
// Data-acquisition cost model + per-client estimator (Spine rewrite · Phase 7)
//
// SINGLE source of truth for our COST to serve a client across ALL data sources.
// Purpose: once the spine is fully wired, estimate a client's monthly cost so we can
// re-verify the $149 / $299 / $499 pricing tiers against real usage.
//
//   ┌─ THE OBVIOUS ADJUSTMENT ──────────────────────────────────────────────┐
//   │ COST_KNOBS below are the reversible cost levers. Change them here, in   │
//   │ ONE place; the social pipeline reads DATA365_POSTS_PER_PULL from here.  │
//   └────────────────────────────────────────────────────────────────────────┘
//
// Sources: Anand's Vatic_Pricing_Model_v3 ("Unit Cost Reference" + Model B) via
// docs/engine-rewrite/cost-levers.md; Data365 pricing (data365.co/pricing, verified 2026-06).
// Figures tagged VERIFY are approximate and should be confirmed against real billing.
// ---------------------------------------------------------------------------

// ── THE OBVIOUS ADJUSTMENT: reversible cost levers ───────────────────────────
export const COST_KNOBS = {
  /** Social posts pulled per profile per refresh. Each post = 1 Data365 credit, so
   *  this is a direct credit lever (vs the fixed 9 credits for profile-with-info).
   *  Lower = cheaper but less social signal — a product/quality tradeoff. */
  data365PostsPerPull: 20,
  /** Photo FETCH cadence (NOT analysis, NOT reviews). Weekly is the big saver. */
  photoFetchCadence: "weekly" as "daily" | "weekly",
  /** DataForSEO cadence. */
  seoCadence: "weekly" as "daily" | "weekly",
} as const

/** Re-exported for the social pipeline so posts-per-pull is tuned in exactly one place. */
export const DATA365_POSTS_PER_PULL = COST_KNOBS.data365PostsPerPull

// ── VERIFIED UNIT COSTS (USD) ────────────────────────────────────────────────
// Per-competitor monthly costs from Anand's model (optimized, weekly cadence, 10+ ws).
export const UNIT_COSTS = {
  placesDetailsReviewsPerCompMo: 0.75, // Google Places details + reviews (keep — never cut)
  placesPhotosPerCompMoWeekly: 1.96, // Places photo FETCH, hash-deduped (was ~6.5)
  geminiVisionPerCompMo: 0.3, // Gemini Vision photo analysis (cheap + essential)
  dataForSeoPerCompMoWeekly: 3.3, // DataForSEO labs/SERP/events
  firecrawlPerCompMo: 0.1,
  outscraperPerCompMo: 0.01,
  weatherPerLocationMo: 0.0,
  claudePerBriefUsd: 0.15, // VERIFY against real token usage (insights+skills+synthesis+voice)
} as const

// Data365 — subscription + shared credit POOL (verified from data365.co/pricing 2026-06).
export const DATA365 = {
  creditsPerProfileInfo: 9,
  creditsPerPost: 1,
  creditsPerPostWithComments: 5, // we do NOT pull comments
  creditsPerSearch: 7,
  plans: {
    basic: { usdPerMonth: 324, credits: 500_000, networks: 1 }, // €300 @ ~1.08 VERIFY fx
    standard: { usdPerMonth: 918, credits: 1_000_000, networks: 3 }, // €850
  },
} as const

const RUNS_PER_MONTH = { daily: 30, weekly: 4.3 } as const
const DORMANT_PULLS_PER_MONTH = 30 / 14 // dormant accounts re-checked ~every 14 days

export type ClientCostParams = {
  competitors: number
  /** Social networks tracked (1 = IG only / Tier 1; 3 = IG+FB+TikTok / Tier 2-3). */
  platforms: number
  /** Fraction of social profiles that are dormant (skip to long cadence). Default 0.5
   *  — the audit measured ~20/33 dormant. */
  dormantFraction?: number
  cadence: "daily" | "weekly"
  postsPerPull?: number
  data365Plan?: "basic" | "standard"
  /** Market price of the tier, to compute COGS% / headroom. */
  monthlyPriceUsd?: number
}

export type ClientCostEstimate = {
  bySourceUsd: Record<string, number>
  data365CreditsPerMonth: number
  totalUsd: number
  perCompetitorUsd: number
  cogsPct: number | null
  marginPct: number | null
  notes: string[]
}

/** Estimate one client's monthly data-acquisition cost across every source. */
export function estimateClientCost(p: ClientCostParams): ClientCostEstimate {
  const comps = Math.max(p.competitors, 0)
  const runs = RUNS_PER_MONTH[p.cadence]
  const postsPerPull = p.postsPerPull ?? COST_KNOBS.data365PostsPerPull
  const dormantFraction = p.dormantFraction ?? 0.5
  const notes: string[] = []

  // Non-Data365 per-competitor costs. Anand's figures are monthly @ weekly cadence;
  // photos + SEO are the daily-sensitive ones — scale them up if cadence is daily.
  const dailyMult = p.cadence === "daily" ? RUNS_PER_MONTH.daily / RUNS_PER_MONTH.weekly : 1
  const places = UNIT_COSTS.placesDetailsReviewsPerCompMo * comps
  const photos = UNIT_COSTS.placesPhotosPerCompMoWeekly * comps * (COST_KNOBS.photoFetchCadence === "daily" ? dailyMult : 1)
  const gemini = UNIT_COSTS.geminiVisionPerCompMo * comps
  const seo = UNIT_COSTS.dataForSeoPerCompMoWeekly * comps * (COST_KNOBS.seoCadence === "daily" ? dailyMult : 1)
  const firecrawl = UNIT_COSTS.firecrawlPerCompMo * comps
  const outscraper = UNIT_COSTS.outscraperPerCompMo * comps
  const weather = UNIT_COSTS.weatherPerLocationMo
  const claude = UNIT_COSTS.claudePerBriefUsd * runs

  // Data365 credits: (location + competitors) × networks profiles. Active profiles pull
  // every run; dormant ones only ~every 14 days (the cadence gate). Amortize this client's
  // share of the monthly subscription pool.
  const profiles = (comps + 1) * Math.max(p.platforms, 1)
  const creditsPerPull = DATA365.creditsPerProfileInfo + postsPerPull * DATA365.creditsPerPost
  const activeProfiles = profiles * (1 - dormantFraction)
  const dormantProfiles = profiles - activeProfiles
  const data365CreditsPerMonth = creditsPerPull * (activeProfiles * runs + dormantProfiles * DORMANT_PULLS_PER_MONTH)
  const plan = DATA365.plans[p.data365Plan ?? (p.platforms <= 1 ? "basic" : "standard")]
  const data365Usd = plan.usdPerMonth * (data365CreditsPerMonth / plan.credits) // share of the pool
  notes.push(`Data365 ${Math.round(data365CreditsPerMonth).toLocaleString()} credits/mo = ${((data365CreditsPerMonth / plan.credits) * 100).toFixed(1)}% of the ${plan.credits.toLocaleString()}-credit pool`)
  notes.push(
    "VARIABLE data-acquisition cost only — excludes fixed infra (Supabase/Vercel/Anthropic/Resend) and the " +
      "Data365 subscription floor (only the marginal credit share is amortized here). Reconcile against Anand's " +
      "full COGS model + REAL wired usage; feed per-tier competitor caps + cadence from the live tier config."
  )

  const bySourceUsd = {
    placesDetailsReviews: round(places),
    placesPhotos: round(photos),
    geminiVision: round(gemini),
    dataForSeo: round(seo),
    firecrawl: round(firecrawl),
    outscraper: round(outscraper),
    weather: round(weather),
    claude: round(claude),
    data365: round(data365Usd),
  }
  const totalUsd = round(Object.values(bySourceUsd).reduce((s, v) => s + v, 0))
  const cogsPct = p.monthlyPriceUsd ? round((totalUsd / p.monthlyPriceUsd) * 100) : null
  const marginPct = cogsPct == null ? null : round(100 - cogsPct)

  return {
    bySourceUsd,
    data365CreditsPerMonth: Math.round(data365CreditsPerMonth),
    totalUsd,
    perCompetitorUsd: comps > 0 ? round(totalUsd / comps) : totalUsd,
    cogsPct,
    marginPct,
    notes,
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
