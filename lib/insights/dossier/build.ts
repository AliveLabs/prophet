// ---------------------------------------------------------------------------
// buildDossier — assemble a real Dossier from the Supabase branch.
//
// Reuses the exact query patterns from lib/jobs/pipelines/insights.ts. Read-only.
// Optional signal fields default to null until their pulls are wired (own listing,
// busy times, social, review sentiment) — honest "not yet populated", not a
// placeholder; skills reason over the 76 rule outputs + what is present.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { Dossier, EntitySignals, RestaurantProfile, Tier } from "@/lib/insights/dossier/types"
import { TIER_CAPS } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import type { MenuSnapshot } from "@/lib/content/types"
import type { NormalizedEvent } from "@/lib/events/types"
import type { DailyWeatherSummary } from "@/lib/providers/openweathermap"
import type { SocialSnapshotData } from "@/lib/social/types"
import type { BriefCoverage } from "@/lib/skills/types"
import type { Transport } from "@/lib/ai/provider"
import { fetchPlaceDetails } from "@/lib/places/google"
import { fetchBusyTimes } from "@/lib/providers/outscraper"
import { fetchForecast } from "@/lib/providers/openweathermap"
import { analyzeReviews, reviewInsightsFromSentiment, type RawReview } from "@/lib/insights/reviews/sentiment"
import { classifyNow, isUsable } from "@/lib/freshness/contract"
import { socialContentAsOf } from "@/lib/freshness/extract"

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
  nowKey: string
): Promise<{ byEntity: Map<string, SocialSnapshotData>; asOf: string | null; excludedDormant: number }> {
  const byEntity = new Map<string, SocialSnapshotData>()
  let asOf: string | null = null
  let excludedDormant = 0
  if (entityIds.length === 0) return { byEntity, asOf, excludedDormant }
  try {
    const { data: profiles } = await sb.from("social_profiles").select("id, entity_id, platform").in("entity_id", entityIds)
    const profs = profiles ?? []
    if (profs.length === 0) return { byEntity, asOf, excludedDormant }
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

    // Pick the latest snapshot per entity (rows are date desc → first seen = latest);
    // prefer Instagram if present for that entity.
    type Latest = { raw: SocialSnapshotData; capturedAt: string; isInstagram: boolean }
    const latestByEntity = new Map<string, Latest>()
    for (const s of snaps ?? []) {
      const prof = profById.get(s.social_profile_id as string)
      if (!prof) continue
      const isInstagram = prof.platform === "instagram"
      const cur = latestByEntity.get(prof.entity_id)
      if (cur && !(isInstagram && !cur.isInstagram)) continue
      latestByEntity.set(prof.entity_id, {
        raw: s.raw_data as SocialSnapshotData,
        capturedAt: (s.captured_at as string) ?? (s.date_key as string),
        isInstagram,
      })
    }

    for (const [entityId, v] of latestByEntity) {
      const rawRec = v.raw as unknown as Record<string, unknown>
      const probe = socialContentAsOf(rawRec)
      const contentAsOf = probe.contentAsOf // self-computed from raw_data (newest post date)
      const status = classifyNow({ contentAsOf, capturedAt: v.capturedAt, isEmpty: probe.isEmpty, kind: "social", now: `${nowKey}T00:00:00Z` })
      if (isUsable(status)) {
        byEntity.set(entityId, v.raw)
        if (contentAsOf && (!asOf || contentAsOf > asOf)) asOf = contentAsOf
      } else {
        excludedDormant++ // dormant / empty / undated — not current, kept out of the brief
      }
    }
  } catch {
    /* social is optional — absence is reported via coverage */
  }
  return { byEntity, asOf, excludedDormant }
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

export async function buildDossier(locationId: string, opts: BuildDossierOptions = {}): Promise<Dossier> {
  const sb = createAdminSupabaseClient()
  const dateKey = opts.dateKey ?? todayKey()
  const tier = TIER_CAPS[opts.tier ?? 2]

  // ── location ──
  const { data: loc } = await sb
    .from("locations")
    .select("id, name, primary_place_id, organization_id, website, timezone, geo_lat, geo_lng")
    .eq("id", locationId)
    .maybeSingle()
  if (!loc) throw new Error(`Location not found: ${locationId}`)

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
        // Service model gates event framing (drive-thru QSR never gets walk-in plays).
        const types: string[] = Array.isArray((details as Record<string, unknown>).types)
          ? ((details as Record<string, unknown>).types as string[])
          : []
        const primary = ((details as Record<string, unknown>).primaryType as string) ?? ""
        const all = [primary, ...types].join(" ")
        serviceModel = /fast_food|meal_takeaway|meal_delivery/.test(all)
          ? "quick service / drive-thru or takeout"
          : /\bbar\b|pub/.test(all)
            ? "bar + dine-in"
            : /restaurant|food/.test(all)
              ? "dine-in"
              : undefined
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
        // review sentiment -> location.reviews + citable review insights (activates Reputation)
        const raw: RawReview[] = recentReviews.map((r) => ({ text: r.text, rating: r.rating, date: r.date }))
        const sentiment = await analyzeReviews(raw, { transport: opts.transport, source: "google_places" })
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
  const { byEntity: socialByEntity, asOf: socialAsOf, excludedDormant: socialDormant } = await loadSocial(sb, entityIds, dateKey)
  const socialFresh = socialByEntity.size > 0
  if (socialFresh) {
    const own = socialByEntity.get(location.entityId)
    if (own) location.social = own
    for (const c of competitors) {
      const s = socialByEntity.get(c.entityId)
      if (s) c.social = s
    }
  }

  const profile: RestaurantProfile = {
    locationId: loc.id as string,
    name: (loc.name as string) ?? "Your location",
    timezone: ((loc as Record<string, unknown>).timezone as string) ?? "America/New_York",
    voiceTone: "warm_personal", // column lands with the skill-layer migration; default until then
    attributes: { ...(serviceModel ? { serviceModel } : {}) },
    capability: {}, // operator-capability profile lands with onboarding; empty until then
  }

  // Guard: with no UPCOMING events, every event-dependent rule-output (new-event
  // signals AND cross-event SEO opportunities) is stale and must not seed "prepare
  // for <past date>" plays. A coherent data refresh repopulates current events + insights.
  let groundedRuleOutputs = events.length > 0 ? ruleOutputs : ruleOutputs.filter((r) => !r.insight_type.includes("event"))
  // Consistency with the social read-fix: if NO social account is currently active, drop
  // social "activity" rule-outputs — a dormant account did not "recently post". Keep the
  // honest social.inactive_account signal. (Source-side, generation is already gated; this
  // also protects against historical stale social-insight rows lingering in the window.)
  if (!socialFresh) {
    groundedRuleOutputs = groundedRuleOutputs.filter(
      (r) => !r.insight_type.startsWith("social.") || r.insight_type === "social.inactive_account"
    )
  }

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
    ruleOutputs: groundedRuleOutputs,
    coverage,
  }
}
