"use server"

import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTierFromPriceId } from "@/lib/billing/tiers"
import {
  getEventsQueriesPerRun,
  getEventsMaxDepth,
} from "@/lib/billing/limits"
import { fetchGoogleEvents } from "@/lib/providers/dataforseo/google-events"
import { normalizeEventsSnapshot } from "@/lib/events/normalize"
import { computeEventsSnapshotDiffHash } from "@/lib/events/hash"
import { matchEventsToCompetitors } from "@/lib/events/match"
import { generateEventInsights } from "@/lib/events/insights"
import type { EventsQuery, NormalizedEventsSnapshotV1 } from "@/lib/events/types"

// ---------------------------------------------------------------------------
// Helper: derive location_name for DataForSEO
// ---------------------------------------------------------------------------

function buildLocationName(location: {
  city?: string | null
  region?: string | null
  country?: string | null
}): string {
  const parts = [
    location.city,
    location.region,
    location.country ?? "United States",
  ].filter(Boolean)
  return parts.join(",")
}

function getDateKey(): string {
  return new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// fetchEventsAction – manual trigger from /events page
// ---------------------------------------------------------------------------

export async function fetchEventsAction(formData: FormData) {
  const user = await requireUser()
  const locationId = String(formData.get("location_id") ?? "")

  if (!locationId) {
    redirect("/events?error=No+location+selected")
  }

  const supabase = await createServerSupabaseClient()

  // Get profile → org
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) {
    redirect("/events?error=No+organization+found")
  }

  // Authorization check: must be owner or admin
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/events?error=Insufficient+permissions")
  }

  // Fetch org tier
  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .maybeSingle()

  const tier = getTierFromPriceId(org?.subscription_tier)

  // Fetch location
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, city, region, country, geo_lat, geo_lng, organization_id")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (!location) {
    redirect("/events?error=Location+not+found")
  }

  const locationName = buildLocationName(location)
  const dateKey = getDateKey()
  const maxQueries = getEventsQueriesPerRun(tier)
  const depth = getEventsMaxDepth(tier)

  // Define queries based on tier
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

  try {
    // -----------------------------------------------------------------------
    // 1. Fetch events from DataForSEO
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // 2. Normalize + hash
    // -----------------------------------------------------------------------
    const snapshot = normalizeEventsSnapshot(rawResults, queries)
    const diffHash = computeEventsSnapshotDiffHash(snapshot)

    // -----------------------------------------------------------------------
    // 3. Upsert location_snapshots
    // -----------------------------------------------------------------------
    // We store one snapshot per horizon; for simplicity, combine into a single
    // snapshot keyed by the first dateRange
    const { error: snapError } = await supabase
      .from("location_snapshots")
      .upsert(
        {
          location_id: locationId,
          provider: "dataforseo_google_events",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: snapshot as unknown as Record<string, unknown>,
          diff_hash: diffHash,
        },
        { onConflict: "location_id,provider,date_key" }
      )

    if (snapError) {
      console.error("Failed to upsert location_snapshots:", snapError)
      redirect(`/events?error=${encodeURIComponent(snapError.message)}&location_id=${locationId}`)
    }

    // -----------------------------------------------------------------------
    // 4. Match events to competitors
    // -----------------------------------------------------------------------
    const { data: approvedCompetitors } = await supabase
      .from("competitors")
      .select("id, name, address, website, metadata, is_active")
      .eq("location_id", locationId)
      .eq("is_active", true)

    const competitors = (approvedCompetitors ?? [])
      .filter((c) => {
        const meta = c.metadata as Record<string, unknown> | null
        return meta?.status === "approved"
      })
      .map((c) => ({
        id: c.id,
        name: c.name,
        address: c.address,
        website: c.website,
      }))

    const matchRecords = matchEventsToCompetitors(snapshot.events, competitors, {
      locationId,
      dateKey,
    })

    if (matchRecords.length > 0) {
      // Delete old matches for this date_key then insert fresh
      await supabase
        .from("event_matches")
        .delete()
        .eq("location_id", locationId)
        .eq("date_key", dateKey)

      const { error: matchError } = await supabase
        .from("event_matches")
        .insert(matchRecords)

      if (matchError) {
        console.error("Failed to insert event_matches:", matchError)
      }
    }

    // -----------------------------------------------------------------------
    // 5. Generate deterministic insights
    // -----------------------------------------------------------------------
    // Load previous snapshot for comparison
    const previousDateKey = getPreviousDateKey(dateKey, 1)
    const { data: prevSnapRow } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "dataforseo_google_events")
      .eq("date_key", previousDateKey)
      .maybeSingle()

    const previousSnapshot = prevSnapRow?.raw_data as NormalizedEventsSnapshotV1 | null

    // Load previous matches
    const { data: prevMatchRows } = await supabase
      .from("event_matches")
      .select("*")
      .eq("location_id", locationId)
      .eq("date_key", previousDateKey)

    const insights = generateEventInsights({
      current: snapshot,
      previous: previousSnapshot,
      matches: matchRecords,
      previousMatches: prevMatchRows ?? null,
      locationId,
      dateKey,
    })

    if (insights.length > 0) {
      const insightsPayload = insights.map((insight) => ({
        location_id: locationId,
        competitor_id: insight.evidence?.competitor_id
          ? String(insight.evidence.competitor_id)
          : null,
        date_key: dateKey,
        insight_type: insight.insight_type,
        title: insight.title,
        summary: insight.summary,
        confidence: insight.confidence,
        severity: insight.severity,
        evidence: insight.evidence,
        recommendations: insight.recommendations,
        status: "new",
      }))

      const { error: insightError } = await supabase
        .from("insights")
        .upsert(insightsPayload, {
          onConflict: "location_id,competitor_id,date_key,insight_type",
        })

      if (insightError) {
        console.error("Failed to upsert insights:", insightError)
      }
    }

    redirect(`/events?location_id=${locationId}&success=Events+fetched+successfully`)
  } catch (error) {
    // re-throw redirect errors
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error
    }
    console.error("fetchEventsAction error:", error)
    redirect(
      `/events?error=${encodeURIComponent(String(error))}&location_id=${locationId}`
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPreviousDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
