// The Pass — Weather, REBUILT to Concept A's structure.
//
// STRUCTURE rebuild (not a reskin): the page now LEADS with a forecast hero
// (now + next-7 TkWeatherStrip with honest demand chips), then weighted at-a-glance
// widgets, the weather→foot-traffic correlation EVIDENCE block, the recharts trend
// in a kit card, weather action plays as TkPlayCards, per-location tiles, and the
// engine's weather-related insights. Empty / first-run uses the kit states.
//
// Server component: ALL data fetching, types, and the OpenWeatherMap forecast/cache
// logic are unchanged from the prior page. Only the PRESENTATION is rebuilt onto the
// shared components/ticket kit. Interactivity / animated viz live in page-local
// client islands (weather-client.tsx). Honest framing: demand is estimated/typical,
// channels are walk-in / foot-traffic — no POS / $ / covers.

import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import LocationFilter from "@/components/ui/location-filter"
import { fetchForecast } from "@/lib/providers/openweathermap"
import { fetchWeatherPageData } from "@/lib/cache/weather"
import { fetchEventsPageData } from "@/lib/cache/events"
import type { NormalizedEventsSnapshotV1, NormalizedEvent } from "@/lib/events/types"
import {
  isInTradeArea,
  eventLocalDate,
  eventStripLabel,
  distanceLabel,
} from "../events/events-map"
import {
  RevealOnView,
  TkCard,
  TkSectionHead,
  TkSoftPanel,
  TkWeatherStrip,
  TkWidgetGrid,
  TkWidget,
  TkEmptyState,
  TkTooltipLayer,
  VizTBubble,
  TkRule,
} from "@/components/ticket"
import {
  WeatherTrend,
  WeatherDemandCorrelation,
  WeatherActionPlays,
  LocationWeatherTiles,
} from "./weather-client"
import {
  toTkWeatherIcon,
  estimateDemandWithEvent,
  type WeatherDay,
  type LocationWeather,
} from "./weather-shared"
import "./weather.css"

type WeatherPageProps = {
  searchParams?: Promise<{
    location_id?: string
    error?: string
  }>
}

const NOW_ICON_GLYPH = {
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
    </svg>
  ),
  cloud: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17 18a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3.5 3.5 0 0 0 6 18z" />
    </svg>
  ),
  rain: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17 14a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3.5 3.5 0 0 0 6 14z" />
      <path d="M8 18v2M12 18v3M16 18v2" />
    </svg>
  ),
  storm: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17 16a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3.5 3.5 0 0 0 6 16z" />
      <path d="M11 14l-2 4h3l-2 4" />
    </svg>
  ),
} as const

function dow(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })
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

  // ── ALT-207: pull the SAME in-trade-area events the Events page shows, and line
  // them up onto the composite's day strip. We reuse the events cache loader +
  // the `isInTradeArea` gate verbatim so the weather composite and the Events page
  // can't disagree about what's "nearby". Events are grouped by their LOCAL
  // calendar date (`eventLocalDate`, wall-clock-safe) so a Sat game badges Sat. ──
  let eventsByDate = new Map<string, NormalizedEvent[]>()
  if (selectedLocationId) {
    try {
      const eventsCache = await fetchEventsPageData(selectedLocationId)
      const snapshot = eventsCache.snapshot
        ? (eventsCache.snapshot.raw_data as unknown as NormalizedEventsSnapshotV1)
        : null
      const inArea = (snapshot?.events ?? []).filter(isInTradeArea)
      const grouped = new Map<string, NormalizedEvent[]>()
      for (const ev of inArea) {
        const day = eventLocalDate(ev)
        if (!day) continue
        const arr = grouped.get(day) ?? []
        arr.push(ev)
        grouped.set(day, arr)
      }
      eventsByDate = grouped
    } catch (err) {
      // Events are additive to the composite — a miss degrades to weather+demand only.
      console.warn("[Weather] Events fetch failed:", err)
    }
  }

  // Per-day: the most notable event (nearest, then highest draw) for the strip badge.
  const topEventForDay = (date: string): NormalizedEvent | null => {
    const list = eventsByDate.get(date)
    if (!list || list.length === 0) return null
    const rank = { major: 3, moderate: 2, minor: 1 } as const
    return [...list].sort((a, b) => {
      const da = typeof a.distanceMiles === "number" ? a.distanceMiles : 99
      const db = typeof b.distanceMiles === "number" ? b.distanceMiles : 99
      if (da !== db) return da - db
      return (b.magnitude ? rank[b.magnitude] : 0) - (a.magnitude ? rank[a.magnitude] : 0)
    })[0]
  }

  // Ensure KPI strip and chart share the same source of truth. Previously the
  // cards read only from cached historical rows while the chart merged in
  // OpenWeatherMap forecasts, so the cards displayed "N/A" / "0" whenever the
  // cache was empty but the forecast had data.
  const kpiDays = weatherDays
  const latestWeather =
    kpiDays.find((d) => d.date === todayStr) ??
    [...kpiDays]
      .filter((d) => d.date <= todayStr)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0] ??
    kpiDays[0]
  const severeCount = kpiDays.filter((d) => d.is_severe).length
  const avgTemp = kpiDays.length > 0
    ? Math.round(kpiDays.reduce((s, d) => s + d.temp_high_f, 0) / kpiDays.length)
    : 0
  const totalPrecip = kpiDays.reduce((s, d) => s + d.precipitation_in, 0)
  const kpiDaysLabel = historicalDays.length > 0 && forecastDays.length > 0
    ? `${historicalDays.length} days history + ${forecastDays.length} day forecast`
    : `${kpiDays.length} ${kpiDays.length === 1 ? "day" : "days"}`

  // ── Next-7 strip: forecast first, top up with the most recent history if the
  // forecast is short (so the lead always shows a full week when we have it). ──
  const upcoming = [...forecastDays].sort((a, b) => a.date.localeCompare(b.date))
  const recentHistory = [...historicalDays].sort((a, b) => b.date.localeCompare(a.date))
  const stripDays = (upcoming.length >= 5
    ? upcoming
    : [...recentHistory.slice(0, Math.max(0, 7 - upcoming.length)).reverse(), ...upcoming]
  ).slice(0, 7)

  // How many days in the visible strip carry a notable event — drives the
  // composite's "events factored in" sub-line (honest: only shown when > 0).
  const eventDaysInView = stripDays.filter((d) => topEventForDay(d.date) != null).length

  const nowIcon = latestWeather ? toTkWeatherIcon(latestWeather.weather_condition, latestWeather.is_severe) : "sun"
  const locationName = selectedLocation?.name ?? "Location"

  const hasData = weatherDays.length > 0

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Your market</span>
        <h1 className="pv-h1">Weather</h1>
        <p className="pv-sub">
          The forecast for {locationName}, read for what it does to your foot traffic — so your brief and
          traffic insights already account for it. All-weather, honest, and estimated.
        </p>
      </div>
      <TkRule />

      <div className="tk-kit tk-weather-body">
        <TkTooltipLayer />

        {/* ── Toolbar: location filter ── */}
        {selectedLocationId && locations && locations.length > 1 ? (
          <div className="tk-weather-toolbar">
            <LocationFilter
              locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
              selectedLocationId={selectedLocationId}
            />
          </div>
        ) : null}

        {hasData ? (
          <>
            {/* ── At-a-glance widgets (honest, no $/covers) ── */}
            <div>
              <TkSectionHead title="At a glance" sub={`Across ${kpiDaysLabel}`} />
              <RevealOnView>
                <TkWidgetGrid>
                  <TkWidget
                    tone="gold"
                    size="wide"
                    label="Avg high"
                    value={`${avgTemp}°F`}
                    sub="mean daily high in view"
                    data-tip="Average daily high across history + forecast"
                    data-tipv={`${avgTemp}°F avg high`}
                    tBubble={
                      <VizTBubble
                        viz={{
                          domain: "weather",
                          metric: "Avg high",
                          value: avgTemp,
                          unit: "°F",
                          timeframe: kpiDaysLabel,
                          source: "OpenWeatherMap",
                          locationId: selectedLocationId ?? undefined,
                        }}
                      />
                    }
                  />
                  <TkWidget
                    tone="slate"
                    label="Total precip"
                    value={`${totalPrecip.toFixed(2)}"`}
                    sub="rain + snow in view"
                    data-tip="Total precipitation across the window"
                    data-tipv={`${totalPrecip.toFixed(2)} inches`}
                    tBubble={
                      <VizTBubble
                        viz={{
                          domain: "weather",
                          metric: "Total precip",
                          value: totalPrecip.toFixed(2),
                          unit: '"',
                          timeframe: kpiDaysLabel,
                          source: "OpenWeatherMap",
                          locationId: selectedLocationId ?? undefined,
                        }}
                      />
                    }
                  />
                  <TkWidget
                    tone={severeCount > 0 ? "rust" : "teal"}
                    label="Severe days"
                    value={String(severeCount)}
                    sub={severeCount > 0 ? "traffic insights adjusted" : "no disruptions"}
                    data-tip="Days flagged severe — we down-weight expected walk-in on these"
                    data-tipv={severeCount > 0 ? `${severeCount} severe day${severeCount === 1 ? "" : "s"}` : "none flagged"}
                    tBubble={
                      <VizTBubble
                        viz={{
                          domain: "weather",
                          metric: "Severe days",
                          value: severeCount,
                          timeframe: kpiDaysLabel,
                          source: "OpenWeatherMap",
                          locationId: selectedLocationId ?? undefined,
                        }}
                      />
                    }
                  />
                  <TkWidget
                    tone="slate"
                    label="Locations"
                    value={String(Math.max(1, allLocationWeather.length))}
                    sub="tracked in your set"
                    data-tip="Locations with a current weather reading"
                    data-tipv={`${Math.max(1, allLocationWeather.length)} tracked`}
                  />
                </TkWidgetGrid>
              </RevealOnView>
            </div>

            {/* ── LEAD: the Concept A "Weather, events & demand" composite —
                now + a next-7 strip that unifies weather (icon/temp), the notable
                nearby events that move demand (rust badge), and the honest
                estimated walk-in read (demand chip). ── */}
            <div>
              <TkSectionHead
                title="Weather, events & demand"
                sub={`All-weather outlook · ${locationName}`}
              />
              <RevealOnView className="tk-hero-wrap">
                <TkCard
                  className="tk-weather-lead"
                  tBubble={
                    <VizTBubble
                      viz={{
                        domain: "weather",
                        metric: "This week's outlook",
                        value: `${avgTemp}°`,
                        timeframe: kpiDaysLabel,
                        source: "OpenWeatherMap",
                        locationId: selectedLocationId ?? undefined,
                      }}
                    />
                  }
                >
                  <div className="tk-eyebrow">Right now · {locationName}</div>
                  <div className="tk-weather-now">
                    <span className={`tk-weather-now-ic tk-${nowIcon}-ic`} aria-hidden="true">
                      {NOW_ICON_GLYPH[nowIcon]}
                    </span>
                    <span className="tk-weather-now-temp">
                      {latestWeather ? `${Math.round(latestWeather.temp_high_f)}°` : "—"}
                    </span>
                    <span className="tk-weather-now-meta">
                      <span className="tk-weather-now-cond">
                        {latestWeather?.weather_condition.toLowerCase() ?? "No reading yet"}
                      </span>
                      <span className="tk-weather-now-sub">
                        {latestWeather && latestWeather.temp_low_f != null
                          ? `Low ${Math.round(latestWeather.temp_low_f)}° · `
                          : ""}
                        {severeCount > 0 ? "Severe days flagged — traffic insights adjusted" : "No disruptions in view"}
                      </span>
                    </span>
                  </div>
                  {stripDays.length > 0 && (
                    <TkWeatherStrip
                      caption="Next 7 · forecast & estimated walk-in demand"
                      captionRight="vs a normal day"
                      days={stripDays.map((d) => {
                        const topEvent = topEventForDay(d.date)
                        const demand = estimateDemandWithEvent(d, topEvent != null)
                        // Event badge wins the slot (it's the demand driver); severe
                        // weather falls back to the badge only when no event lands.
                        const eventLabel = topEvent
                          ? eventStripLabel(topEvent)
                          : d.is_severe
                            ? "Severe"
                            : undefined
                        const demandWord = demand === "up" ? "above" : demand === "down" ? "below" : "around"
                        const tip = topEvent
                          ? `${topEvent.title ?? "Nearby event"} · ${distanceLabel(topEvent.distanceMiles)} — est. walk-in ${demandWord} normal`
                          : `${d.weather_condition} · est. walk-in ${demandWord} normal`
                        return {
                          dow: dow(d.date),
                          icon: toTkWeatherIcon(d.weather_condition, d.is_severe),
                          hi: `${Math.round(d.temp_high_f)}°`,
                          lo: `${Math.round(d.temp_low_f)}°`,
                          demand,
                          event: eventLabel,
                          tip,
                          tipValue: `${Math.round(d.temp_high_f)}° / ${Math.round(d.temp_low_f)}°`,
                        }
                      })}
                    />
                  )}
                  <p className="tk-weather-lead-foot">
                    {eventDaysInView > 0
                      ? `${eventDaysInView} day${eventDaysInView === 1 ? "" : "s"} in view carr${eventDaysInView === 1 ? "ies" : "y"} a notable nearby event — folded into the estimated walk-in read below. `
                      : ""}
                    Demand is estimated from conditions and what&rsquo;s happening nearby — directional, not a measured count.
                  </p>
                </TkCard>
              </RevealOnView>
            </div>

            {/* ── Correlation evidence: weather → foot traffic ── */}
            <RevealOnView>
              <WeatherDemandCorrelation days={weatherDays} />
            </RevealOnView>

            {/* ── Trend chart ── */}
            <RevealOnView>
              <WeatherTrend days={weatherDays} locationName={locationName} todayDate={todayStr} />
            </RevealOnView>

            {/* ── What this means: action plays (header self-hides when none) ── */}
            <RevealOnView>
              <WeatherActionPlays days={weatherDays} />
            </RevealOnView>

            {/* ── All locations ── */}
            {allLocationWeather.length > 1 && (
              <RevealOnView>
                <LocationWeatherTiles locations={allLocationWeather} />
              </RevealOnView>
            )}

            {/* ── Engine weather-related insights ── */}
            {(weatherInsights ?? []).length > 0 && (
              <RevealOnView>
                <TkSoftPanel>
                  <div className="tk-eyebrow">Weather-related insights</div>
                  <div className="tk-wins-list">
                    {(weatherInsights ?? []).map((ins) => (
                      <div
                        key={ins.id}
                        className={`tk-wins-row${ins.severity === "warning" ? " tk-wins-warn" : ""}`}
                      >
                        <p className="tk-wins-title">{ins.title}</p>
                        <p className="tk-wins-sum">{ins.summary}</p>
                        <p className="tk-wins-date">{ins.date_key}</p>
                      </div>
                    ))}
                  </div>
                </TkSoftPanel>
              </RevealOnView>
            )}
          </>
        ) : (
          /* ── EMPTY / FIRST-RUN ── */
          <RevealOnView>
            <TkEmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M2.5 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.3-7.3 3 3 0 0 0-3.75-3.85A5.25 5.25 0 0 0 5.3 10.7 4.5 4.5 0 0 0 2.5 15z" />
                </svg>
              }
              title="No weather data yet"
              description={
                selectedLocationId
                  ? "Hit “Update weather” to pull historical conditions and an 8-day forecast for your area. Once it lands, we’ll read it for what it does to your foot traffic."
                  : "Add a location to start tracking the forecast and how it moves your foot traffic."
              }
            />
          </RevealOnView>
        )}
      </div>
    </div>
  )
}
