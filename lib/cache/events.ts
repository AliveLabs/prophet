import { cacheTag, cacheLife } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type CachedEventsResult = {
  snapshot: { raw_data: unknown; date_key: string } | null
  matchRows: Array<{
    event_uid: string
    competitor_id: string | null
    evidence: unknown
  }>
  // Event-only insights (events.* types) — computed by the events pipeline but previously never
  // surfaced on the events view. The "event-related insights, all inside types" the operator asked for.
  insights: Array<{
    id: string
    title: string
    summary: string
    severity: string | null
    insight_type: string
    date_key: string
    recommendations: unknown
    evidence: unknown
  }>
}

export async function fetchEventsPageData(
  locationId: string,
): Promise<CachedEventsResult> {
  "use cache"
  cacheTag("events-data")
  cacheLife({ revalidate: 604800 })

  const supabase = createAdminSupabaseClient()

  const { data: snapRow } = await supabase
    .from("location_snapshots")
    .select("raw_data, date_key")
    .eq("location_id", locationId)
    .eq("provider", "dataforseo_google_events")
    .order("date_key", { ascending: false })
    .limit(1)
    .maybeSingle()

  let matchRows: CachedEventsResult["matchRows"] = []

  if (snapRow?.date_key) {
    const { data } = await supabase
      .from("event_matches")
      .select("event_uid, competitor_id, evidence")
      .eq("location_id", locationId)
      .eq("date_key", snapRow.date_key)

    matchRows = (data ?? []) as CachedEventsResult["matchRows"]
  }

  const { data: insightRows } = await supabase
    .from("insights")
    .select("id, title, summary, severity, insight_type, date_key, recommendations, evidence")
    .eq("location_id", locationId)
    .like("insight_type", "events.%")
    .order("date_key", { ascending: false })
    .limit(20)

  return {
    snapshot: snapRow ? { raw_data: snapRow.raw_data, date_key: snapRow.date_key } : null,
    matchRows,
    insights: (insightRows ?? []) as CachedEventsResult["insights"],
  }
}
