import { cacheTag, cacheLife } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type CachedWeatherResult = {
  weatherHistory: Array<{
    date: string
    temp_high_f: number | null
    temp_low_f: number | null
    weather_condition: string | null
    weather_icon: string | null
    precipitation_in: number | null
    is_severe: boolean
    humidity_avg: number | null
    wind_speed_max_mph: number | null
  }>
  allLocationWeather: Array<{
    location_id: string
    date: string
    temp_high_f: number | null
    temp_low_f: number | null
    weather_condition: string | null
    weather_icon: string | null
    precipitation_in: number | null
    is_severe: boolean
    humidity_avg: number | null
    wind_speed_max_mph: number | null
  }>
  weatherInsights: Array<{
    id: string
    title: string
    summary: string
    severity: string
    insight_type: string
    date_key: string
  }>
}

export async function fetchWeatherPageData(
  locationId: string,
  allLocationIds: string[],
): Promise<CachedWeatherResult> {
  "use cache"
  cacheTag("weather-data")
  cacheLife({ revalidate: 604800 })

  const supabase = createAdminSupabaseClient()

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const startDate = thirtyDaysAgo.toISOString().slice(0, 10)

  const [{ data: historyRaw }, { data: allWeatherRaw }, { data: insightsRaw }] = await Promise.all([
    supabase
      .from("location_weather")
      .select("date, temp_high_f, temp_low_f, weather_condition, weather_icon, precipitation_in, is_severe, humidity_avg, wind_speed_max_mph")
      .eq("location_id", locationId)
      .gte("date", startDate)
      .order("date", { ascending: false }),
    allLocationIds.length > 0
      ? supabase
          .from("location_weather")
          .select("location_id, date, temp_high_f, temp_low_f, weather_condition, weather_icon, precipitation_in, is_severe, humidity_avg, wind_speed_max_mph")
          .in("location_id", allLocationIds)
          .order("date", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("insights")
      .select("id, title, summary, severity, insight_type, date_key")
      .eq("location_id", locationId)
      .or("insight_type.like.visual.weather%,insight_type.like.traffic.weather%")
      .order("date_key", { ascending: false })
      .limit(10),
  ])

  return {
    weatherHistory: (historyRaw ?? []) as CachedWeatherResult["weatherHistory"],
    allLocationWeather: (allWeatherRaw ?? []) as CachedWeatherResult["allLocationWeather"],
    weatherInsights: (insightsRaw ?? []) as CachedWeatherResult["weatherInsights"],
  }
}
