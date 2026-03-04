// ---------------------------------------------------------------------------
// Weather Pipeline – fetch historical weather and generate cross-signals
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import { fetchHistoricalWeather, type DailyWeatherSummary } from "@/lib/providers/openweathermap"
import { generateWeatherCrossSignals, type WeatherContext } from "@/lib/insights/weather-context"

export type WeatherPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  dateKey: string
  location: {
    id: string
    name: string | null
    geo_lat: number | null
    geo_lng: number | null
  }
  state: {
    todayWeather: DailyWeatherSummary | null
    yesterdayWeather: DailyWeatherSummary | null
    insightsPayload: Array<Record<string, unknown>>
    warnings: string[]
  }
}

export function buildWeatherSteps(): PipelineStepDef<WeatherPipelineCtx>[] {
  return [
    {
      name: "fetch_weather",
      label: "Fetching weather data from OpenWeatherMap",
      run: async (ctx) => {
        if (!ctx.location.geo_lat || !ctx.location.geo_lng) {
          ctx.state.warnings.push("Location missing coordinates")
          return { status: "skipped", reason: "no_coordinates" }
        }

        const today = new Date()
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)

        try {
          const todayWeather = await fetchHistoricalWeather(
            ctx.location.geo_lat,
            ctx.location.geo_lng,
            today
          )
          ctx.state.todayWeather = todayWeather

          await ctx.supabase.from("location_weather").upsert({
            location_id: ctx.locationId,
            date: todayWeather.date,
            temp_high_f: todayWeather.temp_high_f,
            temp_low_f: todayWeather.temp_low_f,
            feels_like_high_f: todayWeather.feels_like_high_f,
            humidity_avg: todayWeather.humidity_avg,
            wind_speed_max_mph: todayWeather.wind_speed_max_mph,
            weather_condition: todayWeather.weather_condition,
            weather_description: todayWeather.weather_description,
            weather_icon: todayWeather.weather_icon,
            precipitation_in: todayWeather.precipitation_in,
            is_severe: todayWeather.is_severe,
          }, { onConflict: "location_id,date" })
        } catch (err) {
          ctx.state.warnings.push(`Today's weather: ${err instanceof Error ? err.message : "failed"}`)
        }

        try {
          const yWeather = await fetchHistoricalWeather(
            ctx.location.geo_lat,
            ctx.location.geo_lng,
            yesterday
          )
          ctx.state.yesterdayWeather = yWeather

          await ctx.supabase.from("location_weather").upsert({
            location_id: ctx.locationId,
            date: yWeather.date,
            temp_high_f: yWeather.temp_high_f,
            temp_low_f: yWeather.temp_low_f,
            feels_like_high_f: yWeather.feels_like_high_f,
            humidity_avg: yWeather.humidity_avg,
            wind_speed_max_mph: yWeather.wind_speed_max_mph,
            weather_condition: yWeather.weather_condition,
            weather_description: yWeather.weather_description,
            weather_icon: yWeather.weather_icon,
            precipitation_in: yWeather.precipitation_in,
            is_severe: yWeather.is_severe,
          }, { onConflict: "location_id,date" })
        } catch (err) {
          ctx.state.warnings.push(`Yesterday's weather: ${err instanceof Error ? err.message : "failed"}`)
        }

        return {
          today: ctx.state.todayWeather
            ? `${ctx.state.todayWeather.weather_condition} ${Math.round(ctx.state.todayWeather.temp_high_f)}°F`
            : "N/A",
          yesterday: ctx.state.yesterdayWeather
            ? `${ctx.state.yesterdayWeather.weather_condition} ${Math.round(ctx.state.yesterdayWeather.temp_high_f)}°F`
            : "N/A",
        }
      },
    },
    {
      name: "generate_weather_signals",
      label: "Generating weather cross-signals",
      run: async (ctx) => {
        const weatherCtx: WeatherContext = {
          today: ctx.state.todayWeather,
          yesterday: ctx.state.yesterdayWeather,
          weekAvg: null,
        }

        // Check for patio photos among competitors
        const { data: comps } = await ctx.supabase
          .from("competitors")
          .select("id")
          .eq("location_id", ctx.locationId)
          .eq("is_active", true)

        let hasPatioPhotos = false
        if (comps?.length) {
          const compIds = comps.map((c) => c.id)
          const { data: photos } = await ctx.supabase
            .from("competitor_photos")
            .select("analysis_result")
            .in("competitor_id", compIds)

          hasPatioPhotos = (photos ?? []).some((p) => {
            const a = p.analysis_result as Record<string, unknown> | null
            return a?.category === "patio_outdoor"
          })
        }

        const signals = generateWeatherCrossSignals(weatherCtx, hasPatioPhotos)

        for (const ins of signals) {
          ctx.state.insightsPayload.push({
            location_id: ctx.locationId,
            competitor_id: null,
            date_key: ctx.dateKey,
            ...ins,
            status: "new",
          })
        }

        if (ctx.state.insightsPayload.length > 0) {
          await ctx.supabase.from("insights").upsert(ctx.state.insightsPayload, {
            onConflict: "location_id,competitor_id,date_key,insight_type",
          })
        }

        return {
          insights_generated: ctx.state.insightsPayload.length,
          has_patio_photos: hasPatioPhotos,
          warnings: ctx.state.warnings,
        }
      },
    },
  ]
}

export async function buildWeatherContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<WeatherPipelineCtx> {
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, geo_lat, geo_lng")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!location) throw new Error("Location not found")

  return {
    supabase,
    locationId,
    organizationId,
    dateKey: new Date().toISOString().slice(0, 10),
    location: {
      id: location.id,
      name: location.name,
      geo_lat: location.geo_lat,
      geo_lng: location.geo_lng,
    },
    state: {
      todayWeather: null,
      yesterdayWeather: null,
      insightsPayload: [],
      warnings: [],
    },
  }
}
