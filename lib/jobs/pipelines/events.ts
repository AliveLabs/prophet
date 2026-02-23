// ---------------------------------------------------------------------------
// Events Pipeline – step definitions
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import { getTierFromPriceId, type SubscriptionTier } from "@/lib/billing/tiers"
import { getEventsQueriesPerRun, getEventsMaxDepth } from "@/lib/billing/limits"
import { fetchGoogleEvents } from "@/lib/providers/dataforseo/google-events"
import { normalizeEventsSnapshot } from "@/lib/events/normalize"
import { computeEventsSnapshotDiffHash } from "@/lib/events/hash"
import { matchEventsToCompetitors } from "@/lib/events/match"
import {
  generateEventInsights,
  type InsightContext,
} from "@/lib/events/insights"
import type {
  EventsQuery,
  NormalizedEventsSnapshotV1,
} from "@/lib/events/types"
import { fetchPlaceDetails } from "@/lib/places/google"

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type EventsPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  tier: SubscriptionTier
  location: {
    id: string
    name: string | null
    city: string | null
    region: string | null
    country: string | null
    primary_place_id: string | null
  }
  dateKey: string
  state: {
    snapshot: NormalizedEventsSnapshotV1 | null
    matchRecords: Array<Record<string, unknown>>
    warnings: string[]
  }
}

function buildLocationName(location: {
  city?: string | null
  region?: string | null
  country?: string | null
}): string {
  return [location.city, location.region, location.country ?? "United States"]
    .filter(Boolean)
    .join(",")
}

function getPreviousDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

export function buildEventsSteps(): PipelineStepDef<EventsPipelineCtx>[] {
  return [
    {
      name: "fetch_events",
      label: "Fetching local events from DataForSEO",
      run: async (c) => {
        const locationName = buildLocationName(c.location)
        const maxQueries = getEventsQueriesPerRun(c.tier)
        const depth = getEventsMaxDepth(c.tier)

        const queryDefs: Array<{
          keyword: string
          dateRange: "week" | "weekend" | "month"
        }> = []

        if (maxQueries >= 2) {
          queryDefs.push(
            { keyword: "events", dateRange: "week" },
            { keyword: "events", dateRange: "weekend" }
          )
        } else {
          queryDefs.push({ keyword: "events", dateRange: "weekend" })
        }

        const rawResults = await Promise.all(
          queryDefs.map((q) =>
            fetchGoogleEvents({
              keyword: q.keyword,
              locationName,
              dateRange: q.dateRange,
              depth,
            })
          )
        )

        const queries: EventsQuery[] = queryDefs.map((q) => ({
          keyword: q.keyword,
          locationName,
          dateRange: q.dateRange,
          depth,
        }))

        c.state.snapshot = normalizeEventsSnapshot(rawResults, queries)
        const diffHash = computeEventsSnapshotDiffHash(c.state.snapshot)

        await c.supabase.from("location_snapshots").upsert(
          {
            location_id: c.locationId,
            provider: "dataforseo_google_events",
            date_key: c.dateKey,
            captured_at: new Date().toISOString(),
            raw_data: c.state.snapshot as unknown as Record<string, unknown>,
            diff_hash: diffHash,
          },
          { onConflict: "location_id,provider,date_key" }
        )

        return { eventsFound: c.state.snapshot.events.length }
      },
    },
    {
      name: "match_competitors",
      label: "Matching events to competitors",
      run: async (c) => {
        if (!c.state.snapshot) return { matches: 0 }

        const { data: approvedCompetitors } = await c.supabase
          .from("competitors")
          .select("id, name, address, website, metadata, is_active")
          .eq("location_id", c.locationId)
          .eq("is_active", true)

        const competitors = (approvedCompetitors ?? [])
          .filter((comp) => {
            const meta = comp.metadata as Record<string, unknown> | null
            return meta?.status === "approved"
          })
          .map((comp) => ({
            id: comp.id,
            name: comp.name,
            address: comp.address,
            website: comp.website,
          }))

        const matchRecords = matchEventsToCompetitors(
          c.state.snapshot.events,
          competitors,
          { locationId: c.locationId, dateKey: c.dateKey }
        )
        c.state.matchRecords = matchRecords as unknown as Array<
          Record<string, unknown>
        >

        if (matchRecords.length > 0) {
          await c.supabase
            .from("event_matches")
            .delete()
            .eq("location_id", c.locationId)
            .eq("date_key", c.dateKey)

          await c.supabase.from("event_matches").insert(matchRecords)
        }

        return { matches: matchRecords.length }
      },
    },
    {
      name: "generate_event_insights",
      label: "Generating event insights",
      run: async (c) => {
        if (!c.state.snapshot) return { insights: 0 }

        const previousDateKey = getPreviousDateKey(c.dateKey, 1)

        const { data: prevSnapRow } = await c.supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", c.locationId)
          .eq("provider", "dataforseo_google_events")
          .eq("date_key", previousDateKey)
          .maybeSingle()
        const previousSnapshot =
          prevSnapRow?.raw_data as NormalizedEventsSnapshotV1 | null

        const { data: prevMatchRows } = await c.supabase
          .from("event_matches")
          .select("*")
          .eq("location_id", c.locationId)
          .eq("date_key", previousDateKey)

        const { data: approvedCompetitors } = await c.supabase
          .from("competitors")
          .select("id, name, metadata, is_active")
          .eq("location_id", c.locationId)
          .eq("is_active", true)

        const insightContext: InsightContext = {
          locationName: c.location.name ?? "Your location",
          locationRating: null,
          locationReviewCount: null,
          competitors: (approvedCompetitors ?? [])
            .filter((comp) => {
              const meta = comp.metadata as Record<string, unknown> | null
              return meta?.status === "approved"
            })
            .map((comp) => {
              const meta = comp.metadata as Record<string, unknown> | null
              const pd = meta?.placeDetails as Record<string, unknown> | null
              return {
                id: comp.id,
                name: comp.name ?? null,
                rating: (pd?.rating as number | null) ?? null,
                reviewCount: (pd?.reviewCount as number | null) ?? null,
              }
            }),
        }

        // Optionally fetch location rating
        try {
          if (c.location.primary_place_id) {
            const details = await fetchPlaceDetails(
              c.location.primary_place_id
            )
            insightContext.locationRating =
              typeof details.rating === "number" ? details.rating : null
            insightContext.locationReviewCount =
              typeof details.userRatingCount === "number"
                ? details.userRatingCount
                : null
          }
        } catch {
          /* non-critical */
        }

        const insights = generateEventInsights({
          current: c.state.snapshot,
          previous: previousSnapshot,
          matches:
            c.state.matchRecords as unknown as Parameters<
              typeof generateEventInsights
            >[0]["matches"],
          previousMatches: prevMatchRows ?? null,
          locationId: c.locationId,
          dateKey: c.dateKey,
          context: insightContext,
        })

        if (insights.length > 0) {
          const insightsPayload = insights.map((insight) => ({
            location_id: c.locationId,
            competitor_id: insight.evidence?.competitor_id
              ? String(insight.evidence.competitor_id)
              : null,
            date_key: c.dateKey,
            insight_type: insight.insight_type,
            title: insight.title,
            summary: insight.summary,
            confidence: insight.confidence,
            severity: insight.severity,
            evidence: insight.evidence,
            recommendations: insight.recommendations,
            status: "new",
          }))

          await c.supabase.from("insights").upsert(insightsPayload, {
            onConflict: "location_id,competitor_id,date_key,insight_type",
          })
        }

        return { insights: insights.length }
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export async function buildEventsContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<EventsPipelineCtx> {
  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .maybeSingle()
  const tier = getTierFromPriceId(org?.subscription_tier)

  const { data: location } = await supabase
    .from("locations")
    .select(
      "id, name, city, region, country, geo_lat, geo_lng, organization_id, primary_place_id"
    )
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!location) throw new Error("Location not found")

  return {
    supabase,
    locationId,
    organizationId,
    tier,
    location: {
      id: location.id,
      name: location.name,
      city: location.city,
      region: location.region,
      country: location.country,
      primary_place_id: location.primary_place_id,
    },
    dateKey: new Date().toISOString().slice(0, 10),
    state: {
      snapshot: null,
      matchRecords: [],
      warnings: [],
    },
  }
}
