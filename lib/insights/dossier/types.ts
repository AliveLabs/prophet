// ---------------------------------------------------------------------------
// The Dossier — the single structured context object every skill reads.
//
// Built once per (location, dateKey) by assembling ALL signals + ALL 76
// deterministic rule outputs + the restaurant profile + competitor set + the
// demand calendar. This is what kills the per-competitor LLM loop: every expert
// skill reasons over the SAME complete picture. The 76 rules' output
// (`ruleOutputs`) is the grounded evidence layer — a skill may only recommend
// what the rules proved (enforced by buildRefIndex + the eval checks).
//
// Wired to the real provider/normalizer types. This is product code, not a stub.
// ---------------------------------------------------------------------------

import type { GeneratedInsight } from "@/lib/insights/types"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import type { MenuSnapshot, SiteContentSnapshot, DetectedFeatures } from "@/lib/content/types"
import type { NormalizedEvent } from "@/lib/events/types"
import type { BusyTimesResult } from "@/lib/providers/outscraper"
import type { DailyWeatherSummary } from "@/lib/providers/openweathermap"
import type { SocialPlatform, SocialSnapshotData, EntityVisualProfile } from "@/lib/social/types"
import type {
  DomainRankSnapshot,
  NormalizedRankedKeyword,
  NormalizedRelevantPage,
  HistoricalTrafficPoint,
  NormalizedIntersectionRow,
  NormalizedAdCreative,
  SerpRankEntry,
} from "@/lib/seo/types"
import type { RefIndex } from "@/lib/eval/checks"
import { extractNumbers } from "@/lib/eval/checks"

// ── Tier (gates cost AND what a brief may reference) ───────────────────────
export type Tier = 1 | 2 | 3
export type TierCaps = {
  tier: Tier
  maxCompetitors: number // 3 / 5 / 10
  maxLocations: number // 1 / 1 / 3
  socialPlatforms: SocialPlatform[] // [ig] / [ig,fb,tt] / [ig,fb,tt]
  seoCadence: "weekly" | "2x_weekly"
  briefCadence: "weekly" | "daily"
  photosPerEntity: number // 10 / 30 / 30
  retentionDays: number // 30 / 90 / 365
}

export const TIER_CAPS: Record<Tier, TierCaps> = {
  1: { tier: 1, maxCompetitors: 3, maxLocations: 1, socialPlatforms: ["instagram"], seoCadence: "weekly", briefCadence: "weekly", photosPerEntity: 10, retentionDays: 30 },
  2: { tier: 2, maxCompetitors: 5, maxLocations: 1, socialPlatforms: ["instagram", "facebook", "tiktok"], seoCadence: "weekly", briefCadence: "daily", photosPerEntity: 30, retentionDays: 90 },
  3: { tier: 3, maxCompetitors: 10, maxLocations: 3, socialPlatforms: ["instagram", "facebook", "tiktok"], seoCadence: "2x_weekly", briefCadence: "daily", photosPerEntity: 30, retentionDays: 365 },
}

// ── Restaurant profile (drives relevance + voice + executable constraints) ──
export type VoiceTone = "professional" | "casual" | "warm_personal" | "playful" | "upscale"

/** What this operator can actually execute — recipes must respect these (no ad team assumed). */
export type OperatorCapability = {
  marketingBudgetBand?: "none" | "low" | "medium" | "high"
  whoRunsMarketing?: "owner" | "staff" | "agency" | "nobody"
  liveChannels?: string[] // channels they run today, e.g. ["instagram","google_business"]
  posCapabilities?: string[] // e.g. ["online_ordering","prix_fixe","loyalty_wallet","reservations"]
  seats?: number | null
}

export type RestaurantProfile = {
  locationId: string
  name: string
  timezone: string // validated from geo; drives local-morning precompute
  voiceTone: VoiceTone
  voiceSample?: string // optional "a sentence in your voice" for few-shot grounding of customer copy
  /**
   * How wide/creative suggestions may be (0 = super on-brand/tame .. 100 = every wild idea).
   * The brand-fit reviewer scores severity objectively; THIS decides what to do with it
   * (drop threshold + downgrade). Recalibrated over time from good/bad feedback. Default 50.
   */
  brandTolerance?: number
  attributes: {
    cuisine?: string
    priceTier?: string
    hasPatio?: boolean
    nearVenues?: string[] // venue names within demand radius
    dayparts?: string[]
  }
  capability: OperatorCapability
}

// ── Per-entity signals (own location + each competitor) ────────────────────
export type SeoSignals = {
  domainRank?: DomainRankSnapshot | null
  rankedKeywords?: NormalizedRankedKeyword[]
  relevantPages?: NormalizedRelevantPage[]
  historicalTraffic?: HistoricalTrafficPoint[]
  intersections?: NormalizedIntersectionRow[]
  ads?: NormalizedAdCreative[]
  serp?: SerpRankEntry[]
}

/** Review sentiment (funded: Outscraper full reviews + a sentiment pass). */
export type ReviewSentiment = {
  themes: { theme: string; sentiment: "positive" | "negative" | "mixed"; mentions: number; examples: string[] }[]
  source: "google_places" | "outscraper"
  windowDays: number
}

export type EntitySignals = {
  entityId: string
  kind: "location" | "competitor"
  name: string
  listing?: NormalizedSnapshot | null // Google Places details + reviews
  menu?: MenuSnapshot | null
  site?: SiteContentSnapshot | null
  features?: DetectedFeatures | null
  seo?: SeoSignals
  social?: SocialSnapshotData | null
  visual?: EntityVisualProfile | null // Gemini Vision profile — KEPT (cheap + essential)
  busyTimes?: BusyTimesResult | null // now includes OWN location (funded)
  reviews?: ReviewSentiment | null
}

// ── The shared demand read (events + weather + busy times) ─────────────────
export type DemandCalendar = {
  events: NormalizedEvent[]
  weather: DailyWeatherSummary[]
  // sizing stays ORDINAL unless grounded in real data — no fabricated headcounts
}

// ── The dossier ────────────────────────────────────────────────────────────
export type Dossier = {
  locationId: string
  dateKey: string
  generatedAt: string
  tier: TierCaps
  profile: RestaurantProfile
  location: EntitySignals // own
  competitors: EntitySignals[]
  demandCalendar: DemandCalendar
  ruleOutputs: GeneratedInsight[] // all 76 deterministic rules = the grounded evidence layer
}

// ---------------------------------------------------------------------------
// Grounding index: the closed set of refs + numbers a skill is allowed to cite.
// Skills/recipes that reference anything outside this are rejected by the eval
// checks (lib/eval/checks.ts). This is the anti-fabrication backbone.
// ---------------------------------------------------------------------------

function collectEvidenceNumbers(value: unknown, into: Set<number>): void {
  if (value == null) return
  if (typeof value === "number" && Number.isFinite(value)) {
    into.add(value)
    return
  }
  if (typeof value === "string") {
    for (const n of extractNumbers(value)) into.add(n)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectEvidenceNumbers(v, into)
    return
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectEvidenceNumbers(v, into)
  }
}

/** Derive the allowed-refs + allowed-numbers index from the dossier's rule outputs. */
export function buildRefIndex(dossier: Dossier): RefIndex {
  const allowedRefs = new Set<string>()
  const evidenceNumbers = new Set<number>()
  for (const insight of dossier.ruleOutputs) {
    allowedRefs.add(insight.insight_type)
    for (const key of Object.keys(insight.evidence ?? {})) {
      allowedRefs.add(`${insight.insight_type}:${key}`)
    }
    collectEvidenceNumbers(insight.evidence, evidenceNumbers)
  }
  return { allowedRefs, evidenceNumbers }
}
