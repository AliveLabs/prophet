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
import type { CategoryPriors } from "@/lib/skills/category-priors"
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
import type { BriefCoverage } from "@/lib/skills/types"

// ── Tier (gates cost AND what a brief may reference) ───────────────────────
export type Tier = 1 | 2 | 3
export type TierCaps = {
  tier: Tier
  maxCompetitors: number // 3 / 5 / 10
  maxLocations: number // 1 / 1 / 3
  /** OWN-account networks collected for this location. Tier 1 = the customer's
   *  ONE chosen network (default instagram — buildDossier resolves the choice
   *  from locations.settings.ownSocialNetwork); tier 2/3 = all three. */
  ownSocialPlatforms: SocialPlatform[]
  /** Competitor coverage is all networks on every tier. */
  competitorSocialPlatforms: SocialPlatform[]
  seoCadence: "weekly" | "2x_weekly"
  briefCadence: "weekly" | "daily"
  photosPerEntity: number // 10 / 30 / 30
  retentionDays: number // 30 / 90 / 365
}

const ALL_PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "tiktok"]

export const TIER_CAPS: Record<Tier, TierCaps> = {
  1: { tier: 1, maxCompetitors: 3, maxLocations: 1, ownSocialPlatforms: ["instagram"], competitorSocialPlatforms: ALL_PLATFORMS, seoCadence: "weekly", briefCadence: "weekly", photosPerEntity: 10, retentionDays: 30 },
  2: { tier: 2, maxCompetitors: 5, maxLocations: 1, ownSocialPlatforms: ALL_PLATFORMS, competitorSocialPlatforms: ALL_PLATFORMS, seoCadence: "weekly", briefCadence: "daily", photosPerEntity: 30, retentionDays: 90 },
  3: { tier: 3, maxCompetitors: 10, maxLocations: 3, ownSocialPlatforms: ALL_PLATFORMS, competitorSocialPlatforms: ALL_PLATFORMS, seoCadence: "2x_weekly", briefCadence: "daily", photosPerEntity: 30, retentionDays: 365 },
}

// ── Restaurant profile (drives relevance + voice + executable constraints) ──
export type VoiceTone = "professional" | "casual" | "warm_personal" | "playful" | "upscale"

/** Which dayparts the restaurant actually serves (Google Places serves* flags — the
 *  reliable signal, no opening-hours text parsing). A play must NOT target a daypart the
 *  restaurant doesn't serve (e.g. no lunch play for a dinner-only spot). undefined = unknown
 *  → no restriction (conservative). */
export type HoursGate = {
  servesBreakfast?: boolean
  servesLunch?: boolean
  servesDinner?: boolean
  servesBrunch?: boolean
  /** Human-readable hours, for display + as a soft fallback when serves* are absent. */
  weekdayDescriptions?: string[]
}

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
  /** Dayparts served — gates daypart-targeted plays (P1). */
  hours?: HoursGate
  /** Per-operator category prior override (P8) — boosts/de-emphasizes domains for THIS location,
   *  layered over the global priors. From locations.settings.categoryPriors. */
  categoryPriors?: CategoryPriors
  attributes: {
    cuisine?: string
    priceTier?: string
    hasPatio?: boolean
    nearVenues?: string[] // venue names within demand radius
    dayparts?: string[]
    /** e.g. "quick service / drive-thru + dine-in", "quick service / drive-thru or takeout",
     *  "bar + dine-in", "dine-in". Shapes event framing: drive-thru/takeout-ONLY skips
     *  walk-in plays; a drive-thru WITH a lobby gets its own lobby-surge + drive-thru shape
     *  (not "no foot traffic"). See lib/skills/prompt-kit.ts EVENT_GEOGRAPHY. */
    serviceModel?: string
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

// ── Partner-entity catalog read (§4.1, P16) — the grassroots anchor set ─────
// Nearby NON-competitor entities (schools/PTA, offices, churches, gyms, hospitals,
// hotels, theaters, breweries, bakeries, farmers-markets, …) the grassroots skill
// turns into partner-named playbooks (spirit nights / catering drivers / reciprocal
// cross-promos). FAIL-SOFT: an absent/unpopulated `partner_catalog` table yields an
// EMPTY array — the grassroots entity-grounded archetypes then DON'T fire and the
// skill stays on its number-free deterministic fallback (today's behavior).
export type PartnerEntitySummary = {
  name: string
  /** One of the PartnerType taxonomy values (school | office | church | …). */
  partnerType: string
  /** Human label for the type (e.g. "school / PTA"). */
  partnerLabel: string
  /** Straight-line miles from this restaurant. */
  distanceMi: number | null
  /** Ordinal audience-size band (small | medium | large) — what the economics scale on. */
  sizeBand: string
  /** LOW anchor of the coarse audience-size proxy (enrollment / headcount / capacity); never a
   *  fabricated true count — the prose treats it as a prior anchor, not a fact about the org. */
  sizeProxyLow: number | null
  sizeProxyHigh: number | null
  /** What the proxy measures (e.g. "enrollment band", "staff headcount", "rooms"). */
  sizeProxyKind: string
}

// ── The shared demand read (events + weather + busy times) ─────────────────
export type DemandCalendar = {
  /** LOCAL demand drivers only (role local_foot/local_traffic, ≤~3mi). These may
   *  ground prepare/staffing/traffic plays. The pretest (2026-06-09) proved the model
   *  won't self-gate on a distance field — exclusion is structural. */
  events: NormalizedEvent[]
  /** Far-away MAJOR events (role metro_hook, e.g. an NBA playoff game across the metro).
   *  Marketing tie-in material ONLY (score promos, watch-party angles) — never local
   *  demand, surfaced only when a concrete play exists, impact scored low. */
  metroHooks?: NormalizedEvent[]
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
  /** §4.1 (P16): nearby NON-competitor partner entities (the grassroots anchor set). Optional +
   *  fail-soft: undefined/empty when the partner_catalog table is absent/unpopulated — the
   *  grassroots entity-grounded archetypes then don't fire (number-free fallback = today). */
  partnerEntities?: PartnerEntitySummary[]
  ruleOutputs: GeneratedInsight[] // all 76 deterministic rules = the grounded evidence layer
  /** Per-signal health: present/stale/missing + as-of date. Drives the "what we checked"
   *  panel and the provider-down resilience model (a stale signal is served, flagged).
   *  Optional so hand-built test fixtures need not supply it (synthesis derives a basic one). */
  coverage?: BriefCoverage[]
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
