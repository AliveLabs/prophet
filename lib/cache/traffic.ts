import { cacheTag, cacheLife } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type CachedTrafficResult = {
  busyTimes: Array<{
    competitor_id: string
    day_of_week: number
    hourly_scores: number[]
    peak_hour: number | null
    peak_score: number | null
    slow_hours: number[] | null
    typical_time_spent: string | null
    current_popularity: number | null
  }>
}

export async function fetchTrafficPageData(
  competitorIds: string[],
): Promise<CachedTrafficResult> {
  "use cache"
  cacheTag("traffic-data")
  cacheLife({ revalidate: 604800 })

  const supabase = createAdminSupabaseClient()

  const { data } = competitorIds.length > 0
    ? await supabase
        .from("busy_times")
        .select("competitor_id, day_of_week, hourly_scores, peak_hour, peak_score, slow_hours, typical_time_spent, current_popularity")
        .in("competitor_id", competitorIds)
        .order("created_at", { ascending: false })
    : { data: [] }

  return {
    busyTimes: (data ?? []) as CachedTrafficResult["busyTimes"],
  }
}
