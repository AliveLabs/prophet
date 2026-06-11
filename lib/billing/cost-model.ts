// ---------------------------------------------------------------------------
// Data-acquisition cost model + per-client estimator (Spine rewrite · Phase 7)
//
// REBUILT BOTTOM-UP (2026-06-09): cost = VOLUME (the calls the REWORKED pipelines
// actually make per run) × verified provider UNIT PRICES × the NEW cadence (weekly +
// dormant-skip). This deliberately does NOT use Anand's old bundled per-competitor
// dollar figures — those were modeled on the pre-rework daily-everything behavior.
//
//   ┌─ THE OBVIOUS ADJUSTMENT ──────────────────────────────────────────────┐
//   │ COST_KNOBS = reversible cost levers (tune here, one place).            │
//   │ UNIT_PRICES = provider truth.   VOLUMES = what the code does per run.  │
//   └────────────────────────────────────────────────────────────────────────┘
//
// Verified unit prices (2026-06): Google Places (developers.google.com/maps pricing),
// Gemini 2.5 Flash (ai.google.dev/pricing), DataForSEO SERP (dataforseo.com), Data365
// (data365.co/pricing), Claude Sonnet (Anthropic). Items tagged ~VERIFY are best-effort.
// VOLUMES are read from lib/jobs/pipelines/* and must be re-calibrated against REAL
// measured usage once the spine is wired (that is the true verification — see notes).
//
// TRIAL & TIER MODEL v2 (2026-06-11): trials run at the MID tier (daily, all
// networks, 5 competitors) — trial COGS ≈ half a month of mid ≈ $50, treated as
// CAC per the Apr 2026 brief § Trial Strategy. Paid Tier 1 own-social is ONE
// network of the customer's choice; competitor pulls (all networks, every tier)
// dominate the social line, so entry recurring cost barely moves vs the old
// instagram-only model.
// ---------------------------------------------------------------------------

// ── THE OBVIOUS ADJUSTMENT: reversible cost levers ───────────────────────────
export const COST_KNOBS = {
  /** Social posts pulled per profile per refresh (each post = 1 Data365 credit). */
  data365PostsPerPull: 20,
  photoFetchCadence: "weekly" as "daily" | "weekly",
  seoCadence: "weekly" as "daily" | "weekly",
} as const

/** Re-exported so the social pipeline tunes posts-per-pull in exactly one place. */
export const DATA365_POSTS_PER_PULL = COST_KNOBS.data365PostsPerPull

// ── VERIFIED PROVIDER UNIT PRICES (USD per call/credit, low-volume tier) ─────
export const UNIT_PRICES = {
  placesDetailsCall: 0.017, // Places Details (Pro) ≤100k/mo (verified)
  placesPhotoCall: 0.007, // Places Photo ≤100k/mo (verified)
  dataForSeoSerpCall: 0.002, // SERP live ($0.60/1k, verified)
  dataForSeoLabsCall: 0.02, // Labs live ~VERIFY (pricier than SERP)
  dataForSeoEventsCall: 0.04, // Events live advanced ~VERIFY
  firecrawlScrape: 0.002, // ~VERIFY (map/scrape)
  outscraperRecord: 0.005, // ~VERIFY
  geminiFlashPerImage: 0.0015, // ~image tokens + prompt/out @ $0.30/$2.50 per M (verified rates)
  geminiFlashPerMenu: 0.002, // menu parse ~VERIFY
  claudeSonnetPerBriefCall: 0.024, // ~3k in@$3/M + 1k out@$15/M per skill/synthesis call (verified rates)
  openWeatherCall: 0.0, // free tier
} as const

// Data365 — verified plans + credit costs (data365.co/pricing). USD via ~1.08 fx (VERIFY).
export const DATA365 = {
  creditsPerProfileInfo: 9,
  creditsPerPost: 1,
  plans: {
    basic: { usdPerMonth: 324, credits: 500_000, networks: 1 },
    standard: { usdPerMonth: 918, credits: 1_000_000, networks: 3 },
  },
  usdPerCredit: { basic: 324 / 500_000, standard: 918 / 1_000_000 },
} as const

// ── VOLUMES: calls per RUN, read from the reworked lib/jobs/pipelines/* ───────
// (loc = per location/run; comp = per approved competitor/run). Calibrate vs real usage.
const VOLUMES = {
  content: { firecrawlLoc: 6, geminiMenuLoc: 1, firecrawlPerComp: 3, geminiMenuPerComp: 1 },
  visibility: { labsLoc: 9, serpLoc: 5, placesLoc: 1, labsPerComp: 4 },
  events: { eventsLoc: 2, placesLoc: 2 },
  photos: { placesRefsPerComp: 1, photosPerComp: 12, visionPerComp: 12 }, // weekly, hash-deduped avg
  traffic: { outscraperPerEntity: 1 }, // location + each competitor
  weather: { openWeatherLoc: 2 },
  brief: { claudeCallsPerBrief: 10 }, // skills + synthesis + voice + review per brief
} as const

const RUNS_PER_MONTH = { daily: 30, weekly: 4.3 } as const
const DORMANT_PULLS_PER_MONTH = 30 / 14 // dormant social re-checked ~every 14 days

export type ClientCostParams = {
  competitors: number
  platforms: number // social networks (1 = IG/Tier1; 3 = all/Tier2-3)
  dormantFraction?: number // share of social profiles dormant (default 0.5 — audit measured ~20/33)
  cadence: "daily" | "weekly"
  postsPerPull?: number
  data365Plan?: "basic" | "standard"
  monthlyPriceUsd?: number
}

export type ClientCostEstimate = {
  bySourceUsd: Record<string, number>
  data365CreditsPerMonth: number
  variableTotalUsd: number
  perCompetitorUsd: number
  cogsPctVariable: number | null
  notes: string[]
}

/** Estimate one client's monthly VARIABLE data-acquisition cost, bottom-up from code volumes. */
export function estimateClientCost(p: ClientCostParams): ClientCostEstimate {
  const comps = Math.max(p.competitors, 0)
  const entities = comps + 1
  const runs = RUNS_PER_MONTH[p.cadence]
  const photoRuns = RUNS_PER_MONTH[COST_KNOBS.photoFetchCadence === "daily" ? p.cadence : "weekly"]
  const seoRuns = RUNS_PER_MONTH[COST_KNOBS.seoCadence === "daily" ? p.cadence : "weekly"]
  const postsPerPull = p.postsPerPull ?? COST_KNOBS.data365PostsPerPull
  const dormantFraction = p.dormantFraction ?? 0.5
  const notes: string[] = []

  // Content (Firecrawl + Gemini menu)
  const firecrawlCalls = (VOLUMES.content.firecrawlLoc + VOLUMES.content.firecrawlPerComp * comps) * runs
  const geminiMenuCalls = (VOLUMES.content.geminiMenuLoc + VOLUMES.content.geminiMenuPerComp * comps) * runs
  const content = firecrawlCalls * UNIT_PRICES.firecrawlScrape + geminiMenuCalls * UNIT_PRICES.geminiFlashPerMenu

  // Visibility (DataForSEO Labs + SERP) — weekly cadence by default
  const labsCalls = (VOLUMES.visibility.labsLoc + VOLUMES.visibility.labsPerComp * comps) * seoRuns
  const serpCalls = VOLUMES.visibility.serpLoc * seoRuns
  const dataForSeoVis = labsCalls * UNIT_PRICES.dataForSeoLabsCall + serpCalls * UNIT_PRICES.dataForSeoSerpCall

  // Events (DataForSEO events) + a little Places for venue matching
  const events = VOLUMES.events.eventsLoc * seoRuns * UNIT_PRICES.dataForSeoEventsCall
  const dataForSeo = dataForSeoVis + events

  // Places (details for location + events matching + photo refs per comp)
  const placesDetailCalls = (VOLUMES.visibility.placesLoc + VOLUMES.events.placesLoc) * seoRuns + VOLUMES.photos.placesRefsPerComp * comps * photoRuns
  const places = placesDetailCalls * UNIT_PRICES.placesDetailsCall

  // Photos (Places Photo SKU + Gemini Vision) — weekly, deduped
  const photoDownloads = VOLUMES.photos.photosPerComp * comps * photoRuns
  const visionCalls = VOLUMES.photos.visionPerComp * comps * photoRuns
  const photos = photoDownloads * UNIT_PRICES.placesPhotoCall
  const geminiVision = visionCalls * UNIT_PRICES.geminiFlashPerImage

  // Traffic (Outscraper) + Weather (free)
  const outscraper = VOLUMES.traffic.outscraperPerEntity * entities * runs * UNIT_PRICES.outscraperRecord
  const weather = VOLUMES.weather.openWeatherLoc * runs * UNIT_PRICES.openWeatherCall

  // Brief engine (Claude reasoning) — per brief, on the run cadence
  const claude = VOLUMES.brief.claudeCallsPerBrief * runs * UNIT_PRICES.claudeSonnetPerBriefCall

  // Data365 social — cadence-gated; dormant accounts on the long cadence (the credit saver)
  const profiles = entities * Math.max(p.platforms, 1)
  const creditsPerPull = DATA365.creditsPerProfileInfo + postsPerPull * DATA365.creditsPerPost
  const activeProfiles = profiles * (1 - dormantFraction)
  const dormantProfiles = profiles - activeProfiles
  const data365CreditsPerMonth = creditsPerPull * (activeProfiles * runs + dormantProfiles * DORMANT_PULLS_PER_MONTH)
  const planKey = p.data365Plan ?? (p.platforms <= 1 ? "basic" : "standard")
  const data365 = data365CreditsPerMonth * DATA365.usdPerCredit[planKey]
  notes.push(`Data365 ${Math.round(data365CreditsPerMonth).toLocaleString()} credits/mo (dormant ${Math.round(dormantFraction * 100)}% skipped to ~14-day cadence)`)

  const bySourceUsd = {
    places: round(places),
    photos: round(photos),
    gemini: round(geminiMenuCalls * UNIT_PRICES.geminiFlashPerMenu + geminiVision),
    dataForSeo: round(dataForSeo),
    firecrawl: round(firecrawlCalls * UNIT_PRICES.firecrawlScrape),
    outscraper: round(outscraper),
    weather: round(weather),
    claude: round(claude),
    data365: round(data365),
  }
  void content // content is split into firecrawl + gemini lines above
  const variableTotalUsd = round(Object.values(bySourceUsd).reduce((s, v) => s + v, 0))
  const cogsPctVariable = p.monthlyPriceUsd ? round((variableTotalUsd / p.monthlyPriceUsd) * 100) : null

  notes.push(
    "VARIABLE data cost from actual reworked-code volumes — calibrate against REAL measured usage once " +
      "wired. EXCLUDES fixed floors (Data365 subscription €300-850/mo, Supabase/Vercel/Anthropic/Resend) " +
      "which dominate COGS at low subscriber counts — add (fixed floors ÷ subscriber count) for true COGS."
  )

  return {
    bySourceUsd,
    data365CreditsPerMonth: Math.round(data365CreditsPerMonth),
    variableTotalUsd,
    perCompetitorUsd: comps > 0 ? round(variableTotalUsd / comps) : variableTotalUsd,
    cogsPctVariable,
    notes,
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
