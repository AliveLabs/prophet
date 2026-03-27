import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import LocationFilter from "@/components/ui/location-filter"
import WeatherHistory, { type WeatherDay } from "@/components/weather/weather-history"
import LocationWeatherCards, { type LocationWeather } from "@/components/weather/location-weather-cards"
import WeatherActionableInsights from "@/components/weather/weather-actionable-insights"
import { Card } from "@/components/ui/card"
import { fetchForecast } from "@/lib/providers/openweathermap"
import { fetchWeatherPageData } from "@/lib/cache/weather"

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
  const requestedLocationId = resolvedParams?.location_id ?? null
  const selectedLocationId = (requestedLocationId && locations?.some((l: { id: string }) => l.id === requestedLocationId))
    ? requestedLocationId
    : locations?.[0]?.id ?? null
  const selectedLocation = locations?.find((l) => l.id === selectedLocationId)

  // Fetch weather data (cached, 7-day TTL)
  const allLocationIds = (locations ?? []).map((l) => l.id)
  const cached = selectedLocationId
    ? await fetchWeatherPageData(selectedLocationId, allLocationIds)
    : { weatherHistory: [], allLocationWeather: [], weatherInsights: [] }

  const historicalDays: WeatherDay[] = cached.weatherHistory.map((w) => ({
    date: w.date,
    temp_high_f: w.temp_high_f ?? 0,
    temp_low_f: w.temp_low_f ?? 0,
    weather_condition: w.weather_condition ?? "Unknown",
    weather_icon: w.weather_icon ?? "01d",
    precipitation_in: w.precipitation_in ?? 0,
    is_severe: w.is_severe,
    humidity_avg: w.humidity_avg,
    wind_speed_max_mph: w.wind_speed_max_mph,
    isForecast: false,
  }))

  // Fetch 8-day forecast from OpenWeatherMap One Call API
  let forecastDays: WeatherDay[] = []
  const todayStr = new Date().toISOString().slice(0, 10)
  const historicalDates = new Set(historicalDays.map((d) => d.date))

  if (selectedLocation?.geo_lat != null && selectedLocation?.geo_lng != null) {
    try {
      const raw = await fetchForecast(selectedLocation.geo_lat, selectedLocation.geo_lng)
      forecastDays = raw
        .filter((d) => d.date > todayStr && !historicalDates.has(d.date))
        .map((d) => ({
          date: d.date,
          temp_high_f: d.temp_high_f,
          temp_low_f: d.temp_low_f,
          weather_condition: d.weather_condition,
          weather_icon: d.weather_icon,
          precipitation_in: d.precipitation_in,
          is_severe: d.is_severe,
          humidity_avg: d.humidity_avg,
          wind_speed_max_mph: d.wind_speed_max_mph,
          isForecast: true,
        }))
    } catch (err) {
      console.warn("[Weather] Forecast fetch failed:", err)
    }
  }

  const weatherDays: WeatherDay[] = [...historicalDays, ...forecastDays]

  // Pick latest weather per location from cache
  const latestByLocation = new Map<string, LocationWeather>()
  for (const w of cached.allLocationWeather) {
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

  const weatherInsights = cached.weatherInsights

  // KPIs (from historical only)
  const latestWeather = historicalDays[0]
  const severeCount = historicalDays.filter((d) => d.is_severe).length
  const avgTemp = historicalDays.length > 0
    ? Math.round(historicalDays.reduce((s, d) => s + d.temp_high_f, 0) / historicalDays.length)
    : 0
  const totalPrecip = historicalDays.reduce((s, d) => s + d.precipitation_in, 0)

  return (
    <section className="space-y-5">
      {/* Filter + Actions Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
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
          />
        )}
      </div>

      {weatherDays.length > 0 ? (
        <>
          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-card">
              <p className="text-xs font-medium text-muted-foreground">Current Conditions</p>
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
                  <p className="text-2xl font-bold text-foreground">
                    {latestWeather ? `${Math.round(latestWeather.temp_high_f)}°F` : "N/A"}
                  </p>
                  <p className="text-[11px] capitalize text-muted-foreground">
                    {latestWeather?.weather_condition.toLowerCase() ?? ""}
                  </p>
                </div>
              </div>
            </Card>
            <Card className="bg-card">
              <p className="text-xs font-medium text-muted-foreground">Avg High Temp</p>
              <p className="mt-2 text-3xl font-bold text-signal-gold">{avgTemp}°F</p>
              <p className="mt-1 text-[11px] text-muted-foreground">over {historicalDays.length} days</p>
            </Card>
            <Card className="bg-card">
              <p className="text-xs font-medium text-muted-foreground">Total Precipitation</p>
              <p className="mt-2 text-3xl font-bold text-primary">{totalPrecip.toFixed(2)}&quot;</p>
              <p className="mt-1 text-[11px] text-muted-foreground">over {historicalDays.length} days</p>
            </Card>
            <Card className="bg-card">
              <p className="text-xs font-medium text-muted-foreground">Severe Weather Days</p>
              <p className={`mt-2 text-3xl font-bold ${severeCount > 0 ? "text-destructive" : "text-precision-teal"}`}>
                {severeCount}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{severeCount > 0 ? "traffic insights adjusted" : "no disruptions"}</p>
            </Card>
          </div>

          {/* Weather History + Forecast Chart */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <WeatherHistory
              days={weatherDays}
              locationName={selectedLocation?.name ?? "Location"}
              todayDate={todayStr}
            />
          </div>

          {/* Actionable Weather Insights */}
          <WeatherActionableInsights days={weatherDays} todayStr={todayStr} />

          {/* All Locations Cards */}
          {allLocationWeather.length > 1 && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <LocationWeatherCards locations={allLocationWeather} />
            </div>
          )}

          {/* Weather-Related Insights */}
          {(weatherInsights ?? []).length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-sm font-bold text-foreground">Weather-Related Insights</h3>
              <div className="mt-3 space-y-2">
                {(weatherInsights ?? []).map((ins) => (
                  <div
                    key={ins.id}
                    className={`rounded-xl border px-4 py-3 ${
                      ins.severity === "warning"
                        ? "border-signal-gold/30 bg-signal-gold/10"
                        : "border-border bg-secondary"
                    }`}
                  >
                    <p className="text-sm font-medium text-foreground">{ins.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{ins.summary}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{ins.date_key}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <svg className="mx-auto h-12 w-12 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-muted-foreground">No weather data yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Click &quot;Update Weather&quot; to fetch historical weather from OpenWeatherMap</p>
        </div>
      )}
    </section>
  )
}
