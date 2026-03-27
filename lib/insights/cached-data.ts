import { cacheTag, cacheLife } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type CachedInsightsResult = {
  insights: Array<{
    id: string
    title: string
    summary: string
    confidence: string
    severity: string
    status: string
    user_feedback: unknown
    evidence: unknown
    recommendations: unknown
    date_key: string
    competitor_id: string | null
    insight_type: string
  }>
  preferences: Array<{
    insight_type: string
    weight: number
    useful_count: number
    dismissed_count: number
  }>
  competitors: Array<{
    id: string
    name: string
    category: string
    metadata: unknown
  }>
  snapshots: Array<{
    competitor_id: string
    date_key: string
    raw_data: unknown
  }>
  weather: Array<{
    date: string
    temp_high_f: number | null
    temp_low_f: number | null
    weather_condition: string | null
    weather_icon: string | null
    precipitation_in: number | null
    is_severe: boolean
  }>
  photos: Array<{
    id: string
    competitor_id: string
    image_url: string | null
    analysis_result: unknown
  }>
  busyTimes: Array<{
    competitor_id: string
    day_of_week: number
    hourly_scores: number[]
    peak_hour: number | null
    peak_score: number | null
    typical_time_spent: string | null
  }>
}

export async function fetchInsightsPageData(
  organizationId: string,
  locationId: string,
  startDate: string,
  statusFilter: string,
  confidenceFilter: string,
  severityFilter: string,
): Promise<CachedInsightsResult> {
  "use cache"
  cacheTag("insights-data")
  cacheLife({ revalidate: 604800 })

  const supabase = createAdminSupabaseClient()

  let insightQuery = supabase
    .from("insights")
    .select(
      "id, title, summary, confidence, severity, status, user_feedback, evidence, recommendations, date_key, competitor_id, insight_type"
    )
    .gte("date_key", startDate)
    .order("date_key", { ascending: false })

  if (locationId) insightQuery = insightQuery.eq("location_id", locationId)
  if (confidenceFilter) insightQuery = insightQuery.eq("confidence", confidenceFilter)
  if (severityFilter) insightQuery = insightQuery.eq("severity", severityFilter)

  const singleStatuses = ["new", "read", "todo", "actioned", "snoozed", "dismissed"]
  if (statusFilter === "saved") {
    insightQuery = insightQuery.eq("status", "read")
  } else if (singleStatuses.includes(statusFilter)) {
    insightQuery = insightQuery.eq("status", statusFilter)
  } else {
    insightQuery = insightQuery.not("status", "in", '("dismissed","snoozed")')
  }

  const [
    { data: insightsRaw },
    { data: prefsRaw },
    { data: competitorsRaw },
  ] = await Promise.all([
    insightQuery,
    supabase
      .from("insight_preferences")
      .select("insight_type, weight, useful_count, dismissed_count")
      .eq("organization_id", organizationId),
    locationId
      ? supabase.from("competitors").select("id, name, category, metadata").eq("location_id", locationId).eq("is_active", true)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; category: string; metadata: unknown }> }),
  ])

  const competitors = (competitorsRaw ?? []) as CachedInsightsResult["competitors"]
  const competitorIds = competitors.map((c) => c.id)

  const [
    { data: snapshotsRaw },
    { data: weatherRaw },
    { data: photosRaw },
    { data: busyTimesRaw },
  ] = await Promise.all([
    competitorIds.length > 0
      ? supabase.from("snapshots").select("competitor_id, date_key, raw_data").in("competitor_id", competitorIds).gte("date_key", startDate)
      : Promise.resolve({ data: [] }),
    locationId
      ? (() => {
          const todayDate = new Date().toISOString().slice(0, 10)
          const yesterday = new Date()
          yesterday.setDate(yesterday.getDate() - 1)
          const yesterdayDate = yesterday.toISOString().slice(0, 10)
          return supabase
            .from("location_weather")
            .select("date, temp_high_f, temp_low_f, weather_condition, weather_icon, precipitation_in, is_severe")
            .eq("location_id", locationId)
            .in("date", [todayDate, yesterdayDate])
            .order("date", { ascending: false })
            .limit(2)
        })()
      : Promise.resolve({ data: [] }),
    competitorIds.length > 0
      ? supabase
          .from("competitor_photos")
          .select("id, competitor_id, image_url, analysis_result")
          .in("competitor_id", competitorIds)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
    competitorIds.length > 0
      ? supabase
          .from("busy_times")
          .select("competitor_id, day_of_week, hourly_scores, peak_hour, peak_score, typical_time_spent")
          .in("competitor_id", competitorIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  return {
    insights: (insightsRaw ?? []) as CachedInsightsResult["insights"],
    preferences: (prefsRaw ?? []).map((p) => ({
      insight_type: p.insight_type,
      weight: Number(p.weight),
      useful_count: p.useful_count,
      dismissed_count: p.dismissed_count,
    })),
    competitors,
    snapshots: (snapshotsRaw ?? []) as CachedInsightsResult["snapshots"],
    weather: (weatherRaw ?? []) as CachedInsightsResult["weather"],
    photos: (photosRaw ?? []) as CachedInsightsResult["photos"],
    busyTimes: (busyTimesRaw ?? []) as CachedInsightsResult["busyTimes"],
  }
}
