import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import LocationFilter from "@/components/ui/location-filter"
import WeatherHistory, { type WeatherDay } from "@/components/weather/weather-history"
import LocationWeatherCards, { type LocationWeather } from "@/components/weather/location-weather-cards"
import { Card } from "@/components/ui/card"

type WeatherPageProps = {
  searchParams?: Promise<{
    location_id?: string
    error?: string
  }>
}

export default async function WeatherPage({ searchParams }: WeatherPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) return null

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, geo_lat, geo_lng")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedParams = await Promise.resolve(searchParams)
  const selectedLocationId = resolvedParams?.location_id ?? locations?.[0]?.id ?? null
  const selectedLocation = locations?.find((l) => l.id === selectedLocationId)

  // Fetch weather history for selected location (last 30 days)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const startDate = thirtyDaysAgo.toISOString().slice(0, 10)

  const { data: weatherHistoryRaw } = selectedLocationId
    ? await supabase
        .from("location_weather")
        .select("date, temp_high_f, temp_low_f, weather_condition, weather_icon, precipitation_in, is_severe, humidity_avg, wind_speed_max_mph")
        .eq("location_id", selectedLocationId)
        .gte("date", startDate)
        .order("date", { ascending: false })
    : { data: [] }

  const weatherDays: WeatherDay[] = (weatherHistoryRaw ?? []).map((w) => ({
    date: w.date,
    temp_high_f: w.temp_high_f ?? 0,
    temp_low_f: w.temp_low_f ?? 0,
    weather_condition: w.weather_condition ?? "Unknown",
    weather_icon: w.weather_icon ?? "01d",
    precipitation_in: w.precipitation_in ?? 0,
    is_severe: w.is_severe,
    humidity_avg: w.humidity_avg,
    wind_speed_max_mph: w.wind_speed_max_mph,
  }))

  // Fetch latest weather for ALL locations
  const allLocationIds = (locations ?? []).map((l) => l.id)
  const { data: allWeatherRaw } = allLocationIds.length > 0
    ? await supabase
        .from("location_weather")
        .select("location_id, date, temp_high_f, temp_low_f, weather_condition, weather_icon, precipitation_in, is_severe, humidity_avg, wind_speed_max_mph")
        .in("location_id", allLocationIds)
        .order("date", { ascending: false })
    : { data: [] }

  // Pick latest per location
  const latestByLocation = new Map<string, LocationWeather>()
  for (const w of allWeatherRaw ?? []) {
    if (latestByLocation.has(w.location_id)) continue
    const loc = locations?.find((l) => l.id === w.location_id)
    latestByLocation.set(w.location_id, {
      location_id: w.location_id,
      location_name: loc?.name ?? "Location",
      date: w.date,
      temp_high_f: w.temp_high_f ?? 0,
      temp_low_f: w.temp_low_f ?? 0,
      weather_condition: w.weather_condition ?? "Unknown",
      weather_icon: w.weather_icon ?? "01d",
      precipitation_in: w.precipitation_in ?? 0,
      is_severe: w.is_severe,
      humidity_avg: w.humidity_avg,
      wind_speed_max_mph: w.wind_speed_max_mph,
    })
  }
  const allLocationWeather = [...latestByLocation.values()]

  // Fetch weather-related insights
  const { data: weatherInsights } = selectedLocationId
    ? await supabase
        .from("insights")
        .select("id, title, summary, severity, insight_type, date_key")
        .eq("location_id", selectedLocationId)
        .or("insight_type.like.visual.weather%,insight_type.like.traffic.weather%")
        .order("date_key", { ascending: false })
        .limit(10)
    : { data: [] }

  // KPIs
  const latestWeather = weatherDays[0]
  const severeCount = weatherDays.filter((d) => d.is_severe).length
  const avgTemp = weatherDays.length > 0
    ? Math.round(weatherDays.reduce((s, d) => s + d.temp_high_f, 0) / weatherDays.length)
    : 0
  const totalPrecip = weatherDays.reduce((s, d) => s + d.precipitation_in, 0)

  return (
    <section className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-600 via-cyan-600 to-teal-600 p-6 text-white shadow-xl shadow-sky-200/50">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/5" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold tracking-tight">Weather Intelligence</h1>
            </div>
            <p className="max-w-md text-sm text-white/70">
              Historical weather data and its impact on competitor traffic for{" "}
              <span className="font-medium text-white/90">
                {selectedLocation?.name ?? "your locations"}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {locations && locations.length > 1 && selectedLocationId && (
              <LocationFilter
                locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
                selectedLocationId={selectedLocationId}
              />
            )}
            {selectedLocationId && (
              <JobRefreshButton
                type="weather"
                locationId={selectedLocationId}
                label="Update Weather"
                pendingLabel="Fetching weather data"
                className="!bg-white/15 !text-white backdrop-blur-sm hover:!bg-white/25"
              />
            )}
          </div>
        </div>
      </div>

      {weatherDays.length > 0 ? (
        <>
          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-white">
              <p className="text-xs font-medium text-slate-500">Current Conditions</p>
              <div className="mt-2 flex items-center gap-2">
                {latestWeather && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://openweathermap.org/img/wn/${latestWeather.weather_icon}@2x.png`}
                    alt={latestWeather.weather_condition}
                    className="h-10 w-10"
                  />
                )}
                <div>
                  <p className="text-2xl font-bold text-slate-900">
                    {latestWeather ? `${Math.round(latestWeather.temp_high_f)}°F` : "N/A"}
                  </p>
                  <p className="text-[11px] capitalize text-slate-500">
                    {latestWeather?.weather_condition.toLowerCase() ?? ""}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="bg-white">
              <p className="text-xs font-medium text-slate-500">Avg High Temp</p>
              <p className="mt-2 text-3xl font-bold text-orange-600">{avgTemp}°F</p>
              <p className="mt-1 text-[11px] text-slate-400">over {weatherDays.length} days</p>
            </Card>
            <Card className="bg-white">
              <p className="text-xs font-medium text-slate-500">Total Precipitation</p>
              <p className="mt-2 text-3xl font-bold text-sky-600">{totalPrecip.toFixed(2)}&quot;</p>
              <p className="mt-1 text-[11px] text-slate-400">over {weatherDays.length} days</p>
            </Card>
            <Card className="bg-white">
              <p className="text-xs font-medium text-slate-500">Severe Weather Days</p>
              <p className={`mt-2 text-3xl font-bold ${severeCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                {severeCount}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">{severeCount > 0 ? "traffic insights adjusted" : "no disruptions"}</p>
            </Card>
          </div>

          {/* Weather History Chart */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <WeatherHistory
              days={weatherDays}
              locationName={selectedLocation?.name ?? "Location"}
            />
          </div>

          {/* All Locations Cards */}
          {allLocationWeather.length > 1 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <LocationWeatherCards locations={allLocationWeather} />
            </div>
          )}

          {/* Weather-Related Insights */}
          {(weatherInsights ?? []).length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">Weather-Related Insights</h3>
              <div className="mt-3 space-y-2">
                {(weatherInsights ?? []).map((ins) => (
                  <div
                    key={ins.id}
                    className={`rounded-xl border px-4 py-3 ${
                      ins.severity === "warning"
                        ? "border-amber-200 bg-amber-50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <p className="text-sm font-medium text-slate-900">{ins.title}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{ins.summary}</p>
                    <p className="mt-1 text-[10px] text-slate-400">{ins.date_key}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <svg className="mx-auto h-12 w-12 text-sky-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-slate-600">No weather data yet</p>
          <p className="mt-1 text-xs text-slate-400">Click &quot;Update Weather&quot; to fetch historical weather from OpenWeatherMap</p>
        </div>
      )}
    </section>
  )
}
