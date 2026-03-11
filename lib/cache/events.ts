import { unstable_cache } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type CachedEventsResult = {
  snapshot: { raw_data: unknown; date_key: string } | null
  matchRows: Array<{
    event_uid: string
    competitor_id: string | null
    evidence: unknown
  }>
}

async function fetchEventsPageDataRaw(
  locationId: string,
): Promise<CachedEventsResult> {
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

  return {
    snapshot: snapRow ? { raw_data: snapRow.raw_data, date_key: snapRow.date_key } : null,
    matchRows,
  }
}

export const fetchEventsPageData = unstable_cache(
  fetchEventsPageDataRaw,
  ["events-page-data"],
  { revalidate: 604800, tags: ["events-data"] }
)
