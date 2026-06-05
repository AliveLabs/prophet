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
import type { Transport } from "@/lib/ai/provider"
import { fetchPlaceDetails } from "@/lib/places/google"
import { fetchBusyTimes } from "@/lib/providers/outscraper"
import { analyzeReviews, reviewInsightsFromSentiment, type RawReview } from "@/lib/insights/reviews/sentiment"

type SB = ReturnType<typeof createAdminSupabaseClient>

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

async function latestSnapshotRaw(sb: SB, locationId: string, provider: string): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await sb
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", provider)
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data?.raw_data as Record<string, unknown>) ?? null
  } catch {
    return null
  }
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
    .select("id, name, primary_place_id, organization_id, website, timezone")
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

  // ── rule outputs: the grounded evidence layer (latest date_key) ──
  const { data: insightRows } = await sb
    .from("insights")
    .select("insight_type,title,summary,confidence,severity,evidence,recommendations,date_key")
    .eq("location_id", locationId)
    .order("date_key", { ascending: false })
    .limit(400)
  const rows = insightRows ?? []
  const latestKey = rows[0]?.date_key ?? null
  const ruleOutputs: GeneratedInsight[] = rows
    .filter((r) => (latestKey ? r.date_key === latestKey : true))
    .map((r) => ({
      insight_type: r.insight_type as string,
      title: r.title as string,
      summary: r.summary as string,
      confidence: r.confidence as GeneratedInsight["confidence"],
      severity: r.severity as GeneratedInsight["severity"],
      evidence: (r.evidence as Record<string, unknown>) ?? {},
      recommendations: (r.recommendations as GeneratedInsight["recommendations"]) ?? [],
    }))

  // ── demand calendar (events + weather) ──
  const eventsRaw = await latestSnapshotRaw(sb, locationId, "dataforseo_google_events")
  const events = ((eventsRaw?.events as NormalizedEvent[]) ?? []) as NormalizedEvent[]
  let weather: DailyWeatherSummary[] = []
  try {
    const { data: w } = await sb
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .in("provider", ["openweathermap", "openweathermap_day_summary", "weather_daily"])
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    const raw = w?.raw_data as Record<string, unknown> | undefined
    weather = (raw?.days as DailyWeatherSummary[]) ?? (Array.isArray(raw) ? (raw as DailyWeatherSummary[]) : [])
  } catch {
    weather = []
  }

  // ── own location signals ──
  const ownMenuRaw = await latestSnapshotRaw(sb, locationId, "firecrawl_menu")
  const location: EntitySignals = {
    entityId: loc.id as string,
    kind: "location",
    name: (loc.name as string) ?? "Your location",
    menu: (ownMenuRaw as MenuSnapshot | null) ?? null,
  }

  // ── FUNDED DATA: own Places details (rating + reviews), own foot traffic, review sentiment ──
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

  const profile: RestaurantProfile = {
    locationId: loc.id as string,
    name: (loc.name as string) ?? "Your location",
    timezone: ((loc as Record<string, unknown>).timezone as string) ?? "America/New_York",
    voiceTone: "warm_personal", // column lands with the skill-layer migration; default until then
    attributes: {},
    capability: {}, // operator-capability profile lands with onboarding; empty until then
  }

  return {
    locationId: loc.id as string,
    dateKey,
    generatedAt: new Date().toISOString(),
    tier,
    profile,
    location,
    competitors,
    demandCalendar: { events, weather },
    ruleOutputs,
  }
}
