// ---------------------------------------------------------------------------
// buildDossier — assemble a real Dossier from the Supabase branch.
//
// Reuses the exact query patterns from lib/jobs/pipelines/insights.ts. Read-only.
// Optional signal fields default to null until their pulls are wired (own listing,
// busy times, social, review sentiment) — honest "not yet populated", not a
// placeholder; skills reason over the 76 rule outputs + what is present.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { Dossier, EntitySignals, HoursGate, RestaurantProfile, ReviewSentiment, Tier, TierCaps } from "@/lib/insights/dossier/types"
import { TIER_CAPS } from "@/lib/insights/dossier/types"
import { asSubscriptionTier, isSocialPlatform, resolveOwnSocialNetworks, type SubscriptionTier } from "@/lib/billing/tiers"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import type { MenuSnapshot } from "@/lib/content/types"
import type { NormalizedEvent } from "@/lib/events/types"
import { sanitizeCategoryPriors } from "@/lib/skills/category-priors"
import type { DailyWeatherSummary } from "@/lib/providers/openweathermap"
import type { SocialSnapshotData } from "@/lib/social/types"
import type { BriefCoverage } from "@/lib/skills/types"
import type { Transport } from "@/lib/ai/provider"
import { fetchPlaceDetails } from "@/lib/places/google"
import { priceLevelToTier, typeToCuisine } from "@/lib/places/format"
import { fetchBusyTimes } from "@/lib/providers/outscraper"
import { fetchForecast } from "@/lib/providers/openweathermap"
import { analyzeReviews, reviewInsightsFromSentiment, type RawReview } from "@/lib/insights/reviews/sentiment"
import { corroboratePriceInsights } from "@/lib/content/insights"
import { aggregateVisualMetrics } from "@/lib/social/visual-analysis"
import type { EntityVisualProfile, SocialPlatform } from "@/lib/social/types"
import { classifyNow, isUsable } from "@/lib/freshness/contract"
import { socialContentAsOf } from "@/lib/freshness/extract"
import { loadPartnerCatalog, PARTNER_TYPE_LABELS, type PartnerType } from "@/lib/local/partner-catalog"

type SB = ReturnType<typeof createAdminSupabaseClient>

// Resilience knobs: a signal stays usable for RETENTION_DAYS (served last-good if its
// provider is down on build day), and is flagged STALE once older than STALE_AFTER_DAYS.
const RETENTION_DAYS = 30
const STALE_AFTER_DAYS = 3

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

/** Age in whole days of a YYYY-MM-DD key relative to `today`; Infinity if absent/unparseable. */
function ageDays(dateKey: string | null | undefined, today: string): number {
  if (!dateKey) return Infinity
  const a = Date.parse(`${today.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${dateKey.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity
  return Math.round((a - b) / 86_400_000)
}

function isoDaysBefore(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

async function latestSnapshotRaw(sb: SB, locationId: string, provider: string): Promise<Record<string, unknown> | null> {
  return (await latestSnapshotMeta(sb, locationId, provider)).raw
}

/** Latest snapshot for a provider WITH its date, so coverage can report freshness. */
async function latestSnapshotMeta(sb: SB, locationId: string, provider: string): Promise<{ raw: Record<string, unknown> | null; dateKey: string | null }> {
  try {
    const { data } = await sb
      .from("location_snapshots")
      .select("raw_data, date_key")
      .eq("location_id", locationId)
      .eq("provider", provider)
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    return { raw: (data?.raw_data as Record<string, unknown>) ?? null, dateKey: (data?.date_key as string) ?? null }
  } catch {
    return { raw: null, dateKey: null }
  }
}

/** One platform's latest snapshot for an entity, classified — input to pickSocialSnapshot. */
export type SocialCandidate = {
  raw: SocialSnapshotData
  platform: string
  status: ReturnType<typeof classifyNow>
  contentAsOf: string | null
}

/**
 * Pick the entity's representative social snapshot from its per-platform candidates:
 * a USABLE platform always beats an unusable one (a dead Instagram must never mask a
 * live TikTok — the Bush's Forney masking bug), newest content wins among usable, and
 * Instagram is only the tiebreak between equals. Null when nothing is usable.
 */
export function pickSocialSnapshot(candidates: SocialCandidate[]): SocialCandidate | null {
  const usable = candidates.filter((c) => isUsable(c.status))
  if (usable.length === 0) return null
  usable.sort(
    (a, b) =>
      (b.contentAsOf ?? "").localeCompare(a.contentAsOf ?? "") ||
      Number(b.platform === "instagram") - Number(a.platform === "instagram")
  )
  return usable[0]
}

/**
 * Latest USABLE social snapshot per entity. Enforces the data-integrity contract at
 * READ time: a snapshot is attached only if its CONTENT (newest post) is current per
 * classifyNow — a dormant account (e.g. last post 2022) is excluded, never shown as
 * activity. `content_as_of` is read from the column when present and recomputed from
 * raw_data otherwise, so the fix holds even before the backfill runs.
 */
async function loadSocial(
  sb: SB,
  entityIds: string[],
  nowKey: string,
  entityMeta: Map<string, { kind: "location" | "competitor"; name: string }>
): Promise<{
  byEntity: Map<string, SocialSnapshotData>
  visualByEntity: Map<string, EntityVisualProfile>
  asOf: string | null
  excludedDormant: number
}> {
  const byEntity = new Map<string, SocialSnapshotData>()
  const visualByEntity = new Map<string, EntityVisualProfile>()
  let asOf: string | null = null
  let excludedDormant = 0
  if (entityIds.length === 0) return { byEntity, visualByEntity, asOf, excludedDormant }
  try {
    const { data: profiles } = await sb.from("social_profiles").select("id, entity_id, platform").in("entity_id", entityIds)
    const profs = profiles ?? []
    if (profs.length === 0) return { byEntity, visualByEntity, asOf, excludedDormant }
    const profById = new Map(profs.map((p) => [p.id as string, p as { entity_id: string; platform: string }]))
    // Note: content_as_of/freshness columns exist in the DB (Phase 1 migration) but are
    // intentionally NOT selected here — the generated types don't include them yet, and
    // raw_data already carries the posts, so we self-compute content recency below. This
    // keeps the read fix correct and regen-independent (works on un-backfilled rows too).
    const { data: snaps } = await sb
      .from("social_snapshots")
      .select("social_profile_id, raw_data, date_key, captured_at")
      .in("social_profile_id", profs.map((p) => p.id as string))
      .order("date_key", { ascending: false })

    // Latest snapshot per (entity, PLATFORM) — rows are date desc → first seen = latest.
    // Classifying per platform BEFORE reducing per entity is the masking-bug fix: the old
    // "prefer Instagram" reduction let a dead Instagram replace a live TikTok before
    // freshness was ever checked (Bush's Forney, found in review).
    type PlatformLatest = { raw: SocialSnapshotData; capturedAt: string; platform: string; entityId: string }
    const latestByEntityPlatform = new Map<string, PlatformLatest>()
    for (const s of snaps ?? []) {
      const prof = profById.get(s.social_profile_id as string)
      if (!prof) continue
      const key = `${prof.entity_id}:${prof.platform}`
      if (latestByEntityPlatform.has(key)) continue
      latestByEntityPlatform.set(key, {
        raw: s.raw_data as SocialSnapshotData,
        capturedAt: (s.captured_at as string) ?? (s.date_key as string),
        platform: prof.platform,
        entityId: prof.entity_id,
      })
    }

    const candidatesByEntity = new Map<string, SocialCandidate[]>()
    for (const v of latestByEntityPlatform.values()) {
      const rawRec = v.raw as unknown as Record<string, unknown>
      const probe = socialContentAsOf(rawRec) // content recency self-computed from raw_data
      const status = classifyNow({ contentAsOf: probe.contentAsOf, capturedAt: v.capturedAt, isEmpty: probe.isEmpty, kind: "social", now: `${nowKey}T00:00:00Z` })
      const list = candidatesByEntity.get(v.entityId) ?? []
      list.push({ raw: v.raw, platform: v.platform, status, contentAsOf: probe.contentAsOf })
      candidatesByEntity.set(v.entityId, list)
    }

    for (const [entityId, cands] of candidatesByEntity) {
      const best = pickSocialSnapshot(cands)
      if (best) {
        byEntity.set(entityId, best.raw)
        if (best.contentAsOf && (!asOf || best.contentAsOf > asOf)) asOf = best.contentAsOf
        // Visual profile from the SAME chosen snapshot, so visual + social describe the
        // same platform/snapshot. Cheap in-memory re-aggregation of existing Gemini Vision
        // analyses already on the posts — NO recompute. Returns null when no post carries
        // a visualAnalysis, so no-vision entities stay honestly empty (positioning +
        // marketing skills both guard null).
        const posts = best.raw.recentPosts ?? []
        const analysisMap = new Map(
          posts.filter((p) => p.visualAnalysis).map((p) => [p.platformPostId, p.visualAnalysis!]),
        )
        if (analysisMap.size > 0) {
          const meta = entityMeta.get(entityId)
          const vp = aggregateVisualMetrics(
            meta?.kind ?? "competitor",
            entityId,
            meta?.name ?? "Unknown",
            best.platform as SocialPlatform,
            posts,
            analysisMap,
          )
          if (vp) visualByEntity.set(entityId, vp)
        }
      } else {
        excludedDormant++ // every platform dormant / empty / undated — kept out of the brief
      }
    }
  } catch {
    /* social is optional — absence is reported via coverage */
  }
  return { byEntity, visualByEntity, asOf, excludedDormant }
}

async function latestCompetitorSnapshot(sb: SB, competitorId: string, snapshotType?: string): Promise<Record<string, unknown> | null> {
  try {
    let q = sb.from("snapshots").select("raw_data").eq("competitor_id", competitorId)
    if (snapshotType) q = q.eq("snapshot_type", snapshotType)
    const { data } = await q.order("date_key", { ascending: false }).limit(1).maybeSingle()
    return (data?.raw_data as Record<string, unknown>) ?? null
  } catch {
    return null
  }
}

export type BuildDossierOptions = { tier?: Tier; dateKey?: string; transport?: Transport }

const TIER_NUMBER: Record<SubscriptionTier, Tier> = {
  entry: 1,
  mid: 2,
  top: 3,
  suspended: 1, // suspended orgs never reach a brief build; value is moot
}

export async function buildDossier(locationId: string, opts: BuildDossierOptions = {}): Promise<Dossier> {
  const sb = createAdminSupabaseClient()
  const dateKey = opts.dateKey ?? todayKey()

  // ── location ──
  const { data: loc } = await sb
    .from("locations")
    .select("id, name, primary_place_id, organization_id, website, timezone, geo_lat, geo_lng, settings")
    .eq("id", locationId)
    .maybeSingle()
  if (!loc) throw new Error(`Location not found: ${locationId}`)

  // ── tier caps: real org tier (opts.tier overrides for tests), with the
  //    Tier-1 own-network choice resolved from location settings ──
  let tier: TierCaps
  if (opts.tier) {
    tier = TIER_CAPS[opts.tier]
  } else {
    const { data: orgRow } = await sb
      .from("organizations")
      .select("subscription_tier")
      .eq("id", loc.organization_id)
      .maybeSingle()
    const subTier = asSubscriptionTier(orgRow?.subscription_tier)
    const caps = TIER_CAPS[TIER_NUMBER[subTier]]
    const settings = (loc.settings as Record<string, unknown> | null) ?? {}
    const chosen = isSocialPlatform(settings.ownSocialNetwork) ? settings.ownSocialNetwork : null
    tier = { ...caps, ownSocialPlatforms: [...resolveOwnSocialNetworks(subTier, chosen)] }
  }

  // ── competitors (approved + active), capped to tier ──
  const { data: comps } = await sb
    .from("competitors")
    .select("id, name, metadata, is_active")
    .eq("location_id", locationId)
    .eq("is_active", true)
  const approved = (comps ?? [])
    .filter((c) => (c.metadata as Record<string, unknown> | null)?.status === "approved")
    .slice(0, tier.maxCompetitors)

  // ── rule outputs: the grounded evidence layer ──
  // Resilience model: take the FRESHEST version of each (insight_type, competitor) within
  // the retention window, NOT a single global latest date_key. A signal whose pipeline did
  // not run today is served last-good (and flagged stale via coverage) instead of silently
  // vanishing — which is exactly the provider-down failure mode we must not have.
  const cutoff = isoDaysBefore(dateKey, RETENTION_DAYS)
  const { data: insightRows } = await sb
    .from("insights")
    .select("insight_type,title,summary,confidence,severity,evidence,recommendations,date_key,competitor_id")
    .eq("location_id", locationId)
    .gte("date_key", cutoff)
    .order("date_key", { ascending: false })
    .limit(1000)
  const rows = insightRows ?? []
  const seenKey = new Set<string>()
  const latestDateByType = new Map<string, string>()
  const ruleOutputs: GeneratedInsight[] = []
  for (const r of rows) {
    const type = r.insight_type as string
    const dk = r.date_key as string
    if (!latestDateByType.has(type)) latestDateByType.set(type, dk) // rows sorted desc → first seen = latest
    const dedupKey = `${type}|${(r.competitor_id as string) ?? ""}`
    if (seenKey.has(dedupKey)) continue // keep only the freshest of each logical insight
    seenKey.add(dedupKey)
    ruleOutputs.push({
      insight_type: type,
      title: r.title as string,
      summary: r.summary as string,
      confidence: r.confidence as GeneratedInsight["confidence"],
      severity: r.severity as GeneratedInsight["severity"],
      evidence: (r.evidence as Record<string, unknown>) ?? {},
      recommendations: (r.recommendations as GeneratedInsight["recommendations"]) ?? [],
    })
  }
  /** Freshest date_key across any insight type matching a predicate (for coverage). */
  const latestDateMatching = (pred: (t: string) => boolean): string | null => {
    let best: string | null = null
    for (const [type, dk] of latestDateByType) if (pred(type) && (!best || dk > best)) best = dk
    return best
  }

  // ── demand calendar (events + weather) ──
  const eventsMeta = await latestSnapshotMeta(sb, locationId, "dataforseo_google_events")
  const eventsRaw = eventsMeta.raw
  const allEvents = ((eventsRaw?.events as NormalizedEvent[]) ?? []) as NormalizedEvent[]
  // Guard 1 (time): only UPCOMING events feed the forward-looking demand calendar.
  const upcoming = allEvents.filter((e) => {
    const when = (e.endDatetime ?? e.startDatetime ?? "") as string
    return !when || when.slice(0, 10) >= dateKey
  })
  // Guard 2 (geography): the events search is metro-wide; "returned" ≠ "nearby".
  // Only LOCAL roles (≤~3mi tiers) may drive demand; far MAJOR events become
  // marketing-hook material; everything else (incl. ungeocoded/legacy un-annotated
  // snapshots, until their next refresh) is excluded — anti-fabrication.
  const events = upcoming.filter((e) => e.role === "local_foot" || e.role === "local_traffic")
  const metroHooks = upcoming.filter((e) => e.role === "metro_hook")
  // Weather = a LIVE forward forecast (fetched here like own reviews/traffic), so the
  // demand calendar always looks AHEAD. The weather pipeline writes historical rows to
  // a different table that the dossier never read, so the forecast never reached the
  // brief; this is the fix. Falls back to any stored snapshot if the forecast fails.
  let weather: DailyWeatherSummary[] = []
  let weatherAsOf: string | null = null
  const lat = (loc as Record<string, unknown>).geo_lat as number | null
  const lng = (loc as Record<string, unknown>).geo_lng as number | null
  if (lat != null && lng != null) {
    try {
      weather = await fetchForecast(lat, lng)
      if (weather.length > 0) weatherAsOf = dateKey // live forecast = fresh as of today
    } catch {
      /* fall back to a stored snapshot below */
    }
  }
  if (weather.length === 0) {
    try {
      const { data: w } = await sb
        .from("location_snapshots")
        .select("raw_data, date_key")
        .eq("location_id", locationId)
        .in("provider", ["openweathermap", "openweathermap_day_summary", "weather_daily"])
        .order("date_key", { ascending: false })
        .limit(1)
        .maybeSingle()
      const raw = w?.raw_data as Record<string, unknown> | undefined
      weather = (raw?.days as DailyWeatherSummary[]) ?? (Array.isArray(raw) ? (raw as DailyWeatherSummary[]) : [])
      if (weather.length > 0) weatherAsOf = (w?.date_key as string) ?? null
    } catch {
      weather = []
    }
  }

  // ── own location signals ──
  const ownMenuMeta = await latestSnapshotMeta(sb, locationId, "firecrawl_menu")
  const ownMenuRaw = ownMenuMeta.raw
  const location: EntitySignals = {
    entityId: loc.id as string,
    kind: "location",
    name: (loc.name as string) ?? "Your location",
    menu: (ownMenuRaw as MenuSnapshot | null) ?? null,
  }

  // ── FUNDED DATA: own Places details (rating + reviews), own foot traffic, review sentiment ──
  let serviceModel: string | undefined
  let operatingHours: HoursGate | undefined
  let priceTier: string | undefined
  let cuisine: string | undefined
  const placeId = (loc as Record<string, unknown>).primary_place_id as string | null
  if (placeId) {
    // own foot traffic (Outscraper on our OWN place) — cheap, unlocks own-vs-rival traffic reasoning
    try {
      location.busyTimes = await fetchBusyTimes(placeId, location.entityId)
    } catch {
      /* non-fatal */
    }
    // own Places details -> listing + review text
    try {
      const details = await fetchPlaceDetails(placeId)
      if (details) {
        // Service model gates event framing. A QSR is SUBDIVIDED by whether it has a
        // lobby: a drive-thru-with-dine-in (e.g. Raising Cane's) gets BOTH walk-in/lobby
        // surge AND drive-thru dynamics; a drive-thru/takeout-ONLY spot skips walk-in
        // framing. `dineIn` (Google Places) is the seating signal; fall back to a seating
        // type hint, else conservatively assume drive-thru-only. (2026-06-19: replaces the
        // old absolute that gave every QSR "drive-thru only" framing and suppressed all of
        // Cane's foot-traffic insights.)
        const types: string[] = Array.isArray((details as Record<string, unknown>).types)
          ? ((details as Record<string, unknown>).types as string[])
          : []
        const primary = ((details as Record<string, unknown>).primaryType as string) ?? ""
        const all = [primary, ...types].join(" ")
        const isQuickService = /fast_food|meal_takeaway|meal_delivery/.test(all)
        const hasSeating =
          details.dineIn === true || /dine_in|cafe|coffee_shop/.test(all)
        serviceModel = isQuickService
          ? hasSeating
            ? "quick service / drive-thru + dine-in"
            : "quick service / drive-thru or takeout"
          : /\bbar\b|pub/.test(all)
            ? "bar + dine-in"
            : /restaurant|food/.test(all)
              ? "dine-in"
              : undefined
        // Price tier + cuisine from Google Places — attributes were previously empty, so the
        // positioning skill's premium-vs-value branch, the brand-fit review, and the prompt
        // locale all read undefined (a premium steakhouse looked like a value spot). Populate them.
        priceTier = priceLevelToTier(details.priceLevel)
        cuisine = typeToCuisine(primary, types)
        // Dayparts served — the reliable gate (P1). serves* may be absent → leave
        // the field undefined (unknown) so no daypart restriction is applied.
        if (
          details.servesBreakfast != null || details.servesLunch != null ||
          details.servesDinner != null || details.servesBrunch != null ||
          details.regularOpeningHours?.weekdayDescriptions?.length
        ) {
          operatingHours = {
            servesBreakfast: details.servesBreakfast,
            servesLunch: details.servesLunch,
            servesDinner: details.servesDinner,
            servesBrunch: details.servesBrunch,
            weekdayDescriptions:
              details.regularOpeningHours?.weekdayDescriptions ??
              details.currentOpeningHours?.weekdayDescriptions,
          }
        }
        const recentReviews = (details.reviews ?? []).map((r, i) => ({
          id: `${details.id ?? "own"}-${i}`,
          rating: r.rating ?? 0,
          text: r.text?.text ?? "",
          date: r.relativePublishTimeDescription ?? "",
        }))
        location.listing = {
          version: "1.0",
          timestamp: new Date().toISOString(),
          profile: { title: details.displayName?.text, rating: details.rating, reviewCount: details.userRatingCount, priceLevel: details.priceLevel ?? undefined },
          recentReviews,
        } as NormalizedSnapshot
        // review sentiment -> location.reviews + citable review insights (activates Reputation).
        // Reuse the sentiment the insights pipeline already computed + persisted (skip a second
        // LLM pass; keep the brief consistent with the Feed); fall back to computing it here.
        const raw: RawReview[] = recentReviews.map((r) => ({ text: r.text, rating: r.rating, date: r.date }))
        const { data: sentSnap } = await sb
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", locationId)
          .eq("provider", "review_sentiment")
          .gte("date_key", cutoff)
          .order("date_key", { ascending: false })
          .limit(1)
          .maybeSingle()
        const persisted = sentSnap?.raw_data as ReviewSentiment | undefined
        const sentiment =
          persisted && Array.isArray(persisted.themes)
            ? persisted
            : await analyzeReviews(raw, { transport: opts.transport, source: "google_places" })
        location.reviews = sentiment
        ruleOutputs.push(...reviewInsightsFromSentiment(sentiment))
      }
    } catch {
      /* non-fatal */
    }
  }

  // ── competitor signals ──
  const competitors: EntitySignals[] = await Promise.all(
    approved.map(async (c) => {
      const [listing, menu] = await Promise.all([
        latestCompetitorSnapshot(sb, c.id as string),
        latestCompetitorSnapshot(sb, c.id as string, "web_menu_weekly"),
      ])
      return {
        entityId: c.id as string,
        kind: "competitor" as const,
        name: (c.name as string) ?? "Competitor",
        listing: (listing as NormalizedSnapshot | null) ?? null,
        menu: (menu as MenuSnapshot | null) ?? null,
      }
    }),
  )

  // ── social: latest USABLE snapshot per entity (data-integrity contract, read side) ──
  // loadSocial classifies by real CONTENT recency, so dormant accounts (e.g. last post
  // 2022) are excluded here — never attached, never presented as current activity.
  const entityIds = [loc.id as string, ...competitors.map((c) => c.entityId)]
  const entityMeta = new Map<string, { kind: "location" | "competitor"; name: string }>([
    [location.entityId, { kind: "location", name: location.name }],
    ...competitors.map((c) => [c.entityId, { kind: "competitor" as const, name: c.name }] as const),
  ])
  const {
    byEntity: socialByEntity,
    visualByEntity: socialVisualByEntity,
    asOf: socialAsOf,
    excludedDormant: socialDormant,
  } = await loadSocial(sb, entityIds, dateKey, entityMeta)
  const socialFresh = socialByEntity.size > 0
  if (socialFresh) {
    const own = socialByEntity.get(location.entityId)
    if (own) location.social = own
    location.visual = socialVisualByEntity.get(location.entityId) ?? null
    for (const c of competitors) {
      const s = socialByEntity.get(c.entityId)
      if (s) c.social = s
      c.visual = socialVisualByEntity.get(c.entityId) ?? null
    }
  }

  // P8: per-operator category prior override (locations.settings.categoryPriors), sanitized.
  const sanitizedPriors = sanitizeCategoryPriors(
    ((loc.settings as Record<string, unknown> | null) ?? {}).categoryPriors,
  )

  const profile: RestaurantProfile = {
    locationId: loc.id as string,
    name: (loc.name as string) ?? "Your location",
    timezone: ((loc as Record<string, unknown>).timezone as string) ?? "America/New_York",
    voiceTone: "warm_personal", // column lands with the skill-layer migration; default until then
    ...(operatingHours ? { hours: operatingHours } : {}),
    ...(Object.keys(sanitizedPriors).length ? { categoryPriors: sanitizedPriors } : {}),
    attributes: {
      ...(serviceModel ? { serviceModel } : {}),
      ...(priceTier ? { priceTier } : {}),
      ...(cuisine ? { cuisine } : {}),
    },
    capability: {}, // operator-capability profile lands with onboarding; empty until then
  }

  // Guard: with no UPCOMING events, every event-dependent rule-output (new-event
  // signals AND cross-event SEO opportunities) is stale and must not seed "prepare
  // for <past date>" plays. A coherent data refresh repopulates current events + insights.
  // P4/P4.1: corroborate "you look expensive" price plays against our own reviews — reframe the
  // uncorroborated ones to positioning instead of a reflexive price cut. The insights pipeline
  // already applies this at WRITE time (so every surface reads corrected rows); this read-time
  // pass is an idempotent safety net that also uses the fresher review sentiment computed for
  // this brief. The insight_type never changes — the verdict rides on evidence.corroboration.
  const corroboratedOutputs = corroboratePriceInsights(ruleOutputs, location.reviews ?? null)
  let groundedRuleOutputs = events.length > 0 ? corroboratedOutputs : corroboratedOutputs.filter((r) => !r.insight_type.includes("event"))
  // Consistency with the social read-fix: if NO social account is currently active, drop
  // social "activity" rule-outputs — a dormant account did not "recently post". Keep the
  // honest social.inactive_account signal. (Source-side, generation is already gated; this
  // also protects against historical stale social-insight rows lingering in the window.)
  if (!socialFresh) {
    groundedRuleOutputs = groundedRuleOutputs.filter(
      (r) => !r.insight_type.startsWith("social.") || r.insight_type === "social.inactive_account"
    )
  }

  // ── partner-entity catalog (§4.1, P16): the grassroots anchor set. READ-ONLY here (the events
  //    pipeline POPULATES + refreshes it, mirroring venue_catalog). FAIL-SOFT: an absent/empty
  //    partner_catalog table → [] → the grassroots entity-grounded archetypes don't fire and the
  //    skill stays on its number-free fallback (today's behavior). Never throws (loadPartnerCatalog
  //    swallows a missing-table error). ──
  const partners = await loadPartnerCatalog(sb, locationId)
  const partnerEntities = partners.map((p) => ({
    name: p.name,
    partnerType: p.partnerType as string,
    partnerLabel: PARTNER_TYPE_LABELS[p.partnerType as PartnerType] ?? p.partnerType,
    distanceMi: p.distanceMi,
    sizeBand: p.sizeBand as string,
    sizeProxyLow: p.sizeProxyLow,
    sizeProxyHigh: p.sizeProxyHigh,
    sizeProxyKind: p.sizeProxyKind,
  }))

  // ── coverage: per-signal health (present/stale/missing + as-of) for the panel + resilience ──
  const mk = (label: string, present: boolean, detail: string, asOf: string | null): BriefCoverage => ({
    label,
    present,
    detail,
    asOf,
    stale: present && ageDays(asOf, dateKey) > STALE_AFTER_DAYS,
  })
  const scraped = competitors.filter((c) => c.listing || c.menu).length
  const reviewThemes = location.reviews?.themes?.length ?? 0
  const seoAsOf = latestDateMatching((t) => t.startsWith("seo") || t.startsWith("visibility") || t.startsWith("traffic") || t.startsWith("baseline") || t.includes("event"))
  // Customer-plain language (no dev/designer jargon: no "parsed"/"scraped"/"themes"/"profiles").
  // First-pass copy — flagged for a dedicated UX-writer pass before this ever faces customers.
  const coverage: BriefCoverage[] = [
    mk("Local events", events.length > 0, events.length ? `${events.length} coming up` : "none coming up", events.length ? eventsMeta.dateKey : null),
    mk("Weather", weather.length > 0, weather.length ? `${weather.length}-day forecast` : "not available", weatherAsOf),
    mk("Reviews", reviewThemes > 0, reviewThemes ? `${reviewThemes} topic${reviewThemes === 1 ? "" : "s"}` : "none yet", reviewThemes ? dateKey : null),
    mk("Foot traffic", !!location.busyTimes, location.busyTimes ? "your busy times" : "not available", location.busyTimes ? dateKey : null),
    mk("Your menu", !!location.menu, location.menu ? "up to date" : "not added", ownMenuMeta.dateKey),
    mk("Competitors", scraped > 0, `${scraped} of ${competitors.length} checked`, seoAsOf),
    mk("Social", socialFresh, socialFresh ? `${socialByEntity.size} active account${socialByEntity.size === 1 ? "" : "s"}` : socialDormant > 0 ? "no recent activity" : "not connected", socialFresh ? socialAsOf : null),
    mk("Nearby partners", partnerEntities.length > 0, partnerEntities.length ? `${partnerEntities.length} nearby` : "not mapped yet", partnerEntities.length ? dateKey : null),
  ]

  return {
    locationId: loc.id as string,
    dateKey,
    generatedAt: new Date().toISOString(),
    tier,
    profile,
    location,
    competitors,
    demandCalendar: { events, metroHooks, weather },
    ...(partnerEntities.length ? { partnerEntities } : {}),
    ruleOutputs: groundedRuleOutputs,
    coverage,
  }
}
