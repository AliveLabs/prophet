"use client"

// The Pass — Weather page-local client islands.
//
// These RE-IMPLEMENT the presentation of the shared components/weather/* parts
// (the recharts trend, the per-location cards, the actionable-insights cards, and
// a NEW weather→demand correlation viz) directly on The Pass kit. The page stays a
// server component; only these interactive/animated bits are client. No data layer
// or business logic is changed — the analysis functions are ported verbatim from the
// prior shared components, only their JSX is rebuilt onto the kit.
//
// Honest framing throughout: demand is "estimated"/"typically", channels are
// foot-traffic/walk-in (no POS / $ / covers). All viz animate 0→value on in-view via
// the kit's own useInView, and no-op under prefers-reduced-motion.

import { useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts"
import { useChartColors } from "@/lib/hooks/use-chart-colors"
import {
  TkCard,
  TkSoftPanel,
  TkPlayCard,
  TkChip,
  TkSectionHead,
  TkSentimentRows,
  useInView,
} from "@/components/ticket"
import type { TkWeatherIcon, TkDemand } from "@/components/ticket"

/* ════════════════════════════════════════════════════════════════════
   Shared day shape (matches the page's WeatherDay) + helpers
   ════════════════════════════════════════════════════════════════════ */
export type WeatherDay = {
  date: string
  temp_high_f: number
  temp_low_f: number
  weather_condition: string
  weather_icon: string
  precipitation_in: number
  is_severe: boolean
  humidity_avg: number | null
  wind_speed_max_mph: number | null
  isForecast?: boolean
}

export type LocationWeather = {
  location_id: string
  location_name: string
  date: string
  temp_high_f: number
  temp_low_f: number
  weather_condition: string
  weather_icon: string
  precipitation_in: number
  is_severe: boolean
  humidity_avg: number | null
  wind_speed_max_mph: number | null
}

// OpenWeather condition string → the kit's 4 weather glyphs.
export function toTkWeatherIcon(condition: string, isSevere: boolean): TkWeatherIcon {
  const c = (condition ?? "").toLowerCase()
  if (isSevere || c.includes("thunder") || c.includes("storm")) return "storm"
  if (c.includes("rain") || c.includes("drizzle") || c.includes("snow") || c.includes("sleet")) return "rain"
  if (c.includes("cloud") || c.includes("overcast") || c.includes("fog") || c.includes("mist") || c.includes("haze")) return "cloud"
  return "sun"
}

// Honest demand estimate from conditions — NOT a measured number. Mirrors the
// directional language already used in the actionable-insights copy: harsh weather
// pulls walk-in down, mild/clear weekend warmth lifts it, everything else is flat.
export function estimateDemand(d: WeatherDay): TkDemand {
  const c = (d.weather_condition ?? "").toLowerCase()
  const wet = c.includes("rain") || c.includes("drizzle") || c.includes("snow") || c.includes("storm") || d.precipitation_in > 0.2
  if (d.is_severe || c.includes("thunder")) return "down"
  if (wet) return "down"
  if (d.temp_low_f < 35 || d.temp_high_f > 98) return "down"
  const dow = new Date(d.date + "T12:00:00Z").getDay()
  const isWeekend = dow === 0 || dow === 6
  if (d.temp_high_f >= 68 && d.temp_high_f <= 88 && d.precipitation_in < 0.05) {
    return isWeekend ? "up" : "flat"
  }
  return "flat"
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

/* ════════════════════════════════════════════════════════════════════
   WeatherTrend — recharts trend re-housed in a TkCard.
   (Logic ported verbatim from components/weather/weather-history.tsx; only the
   surrounding chrome is rebuilt onto the kit.)
   ════════════════════════════════════════════════════════════════════ */
type ChartRow = {
  date: string
  label: string
  tempRange: [number, number]
  high: number
  low: number
  precipitation: number
  humidity: number | null
  wind: number | null
  condition: string
  icon: string
  isForecast: boolean
  isSevere: boolean
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: ChartRow }> }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div className="tk-card" style={{ padding: "12px 14px", minWidth: 160 }}>
      <p className="tk-mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>
        {new Date(row.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        {row.isForecast && (
          <span
            className="tk-mono"
            style={{ marginLeft: 6, padding: "1px 5px", borderRadius: 5, background: "var(--slate-tint)", color: "var(--slate-deep)", fontSize: 9, fontWeight: 700 }}
          >
            FORECAST
          </span>
        )}
      </p>
      <p style={{ fontSize: 11, color: "var(--ink-2)", textTransform: "capitalize", marginTop: 2 }}>
        {row.condition.toLowerCase()}
      </p>
      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "auto auto", gap: "2px 14px", fontSize: 11 }}>
        <span style={{ color: "var(--ink-2)" }}>High</span>
        <span className="tk-mono" style={{ fontWeight: 700, color: "var(--gold-deep)", textAlign: "right" }}>{Math.round(row.high)}°F</span>
        <span style={{ color: "var(--ink-2)" }}>Low</span>
        <span className="tk-mono" style={{ fontWeight: 700, color: "var(--slate-deep)", textAlign: "right" }}>{Math.round(row.low)}°F</span>
        {row.precipitation > 0 && (
          <>
            <span style={{ color: "var(--ink-2)" }}>Precip</span>
            <span className="tk-mono" style={{ fontWeight: 700, color: "#4E7AA8", textAlign: "right" }}>{row.precipitation.toFixed(2)}&quot;</span>
          </>
        )}
        {row.humidity != null && (
          <>
            <span style={{ color: "var(--ink-2)" }}>Humidity</span>
            <span className="tk-mono" style={{ color: "var(--ink-2)", textAlign: "right" }}>{row.humidity}%</span>
          </>
        )}
        {row.wind != null && (
          <>
            <span style={{ color: "var(--ink-2)" }}>Wind</span>
            <span className="tk-mono" style={{ color: "var(--ink-2)", textAlign: "right" }}>{Math.round(row.wind)} mph</span>
          </>
        )}
      </div>
      {row.isSevere && (
        <div
          style={{ marginTop: 8, padding: "3px 7px", borderRadius: 6, background: "var(--alert-wash)", color: "var(--alert-deep)", fontSize: 10, fontWeight: 700 }}
        >
          Severe weather
        </div>
      )}
    </div>
  )
}

export function WeatherTrend({
  days,
  locationName,
  todayDate,
}: {
  days: WeatherDay[]
  locationName: string
  todayDate?: string
}) {
  const isClient = useIsClient()
  const colors = useChartColors()

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const histCount = sorted.filter((d) => !d.isForecast).length
  const forecastCount = sorted.filter((d) => d.isForecast).length

  return (
    <TkCard className="tk-trend-card">
      <div className="tk-trend-head">
        <div>
          <div className="tk-eyebrow">Weather trend</div>
          <p className="tk-trend-sub">
            {locationName} · {histCount} day{histCount !== 1 ? "s" : ""} history
            {forecastCount > 0 ? ` + ${forecastCount} day forecast` : ""}
          </p>
        </div>
        <div className="tk-trend-legend">
          <span><i style={{ background: "linear-gradient(90deg, var(--slate), var(--gold))" }} /> Temp range</span>
          <span><i style={{ background: "#4E7AA8" }} /> Precip</span>
          {forecastCount > 0 && <span><i className="tk-trend-leg-dash" /> Forecast</span>}
        </div>
      </div>

      <div className="tk-trend-plot">
        {!isClient ? (
          <div className="tk-trend-skel" aria-hidden="true" />
        ) : sorted.length === 0 ? null : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sorted.map<ChartRow>((d) => ({
              date: d.date,
              label: formatDateLabel(d.date),
              tempRange: [d.temp_low_f, d.temp_high_f],
              high: d.temp_high_f,
              low: d.temp_low_f,
              precipitation: d.precipitation_in,
              humidity: d.humidity_avg,
              wind: d.wind_speed_max_mph,
              condition: d.weather_condition,
              icon: d.weather_icon,
              isForecast: d.isForecast ?? false,
              isSevere: d.is_severe,
            }))} margin={{ top: 12, right: 14, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="tkTempGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.signalGold} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={colors.precisionTeal} stopOpacity={0.12} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: colors.mutedForeground }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(0, Math.floor(sorted.length / 10) - 1)}
              />
              <YAxis
                yAxisId="temp"
                domain={[
                  Math.floor(Math.min(...sorted.flatMap((d) => [d.temp_high_f, d.temp_low_f])) / 5) * 5 - 5,
                  Math.ceil(Math.max(...sorted.flatMap((d) => [d.temp_high_f, d.temp_low_f])) / 5) * 5 + 5,
                ]}
                tick={{ fontSize: 10, fill: colors.mutedForeground }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v}°`}
                width={38}
              />
              <YAxis
                yAxisId="precip"
                orientation="right"
                tick={{ fontSize: 10, fill: colors.mutedForeground }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v}"`}
                width={34}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.border }} />
              {todayDate && (
                <ReferenceLine
                  yAxisId="temp"
                  x={formatDateLabel(todayDate)}
                  stroke={colors.foreground}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  label={{ value: "Today", position: "top", fill: colors.foreground, fontSize: 10, fontWeight: 700 }}
                />
              )}
              <Area yAxisId="temp" dataKey="tempRange" fill="url(#tkTempGrad)" stroke="none" activeDot={false} isAnimationActive={false} />
              <Line yAxisId="temp" dataKey="high" stroke={colors.signalGold} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: colors.signalGold, strokeWidth: 0 }} isAnimationActive={false} />
              <Line yAxisId="temp" dataKey="low" stroke={colors.foreground} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: colors.foreground, strokeWidth: 0 }} isAnimationActive={false} />
              <Bar yAxisId="precip" dataKey="precipitation" fill="#4E7AA8" radius={[3, 3, 0, 0]} maxBarSize={12} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="tk-trend-src">Data: OpenWeatherMap</p>
    </TkCard>
  )
}

/* ════════════════════════════════════════════════════════════════════
   WeatherDemandCorrelation — NEW honest evidence block.
   Buckets the last 7/14 days of HISTORY by condition and shows, per bucket, the
   estimated walk-in effect as kit sentiment-style bars. Honest: it's a directional
   model off conditions, not measured covers.
   ════════════════════════════════════════════════════════════════════ */
type Bucket = {
  label: string
  icon: TkWeatherIcon
  count: number
  // estimated walk-in vs a clear baseline, as a signed percent (directional)
  effectPct: number
}

function bucketHistory(days: WeatherDay[]): { buckets: Bucket[]; window: number } {
  const hist = days.filter((d) => !d.isForecast)
  const window = Math.min(14, hist.length)
  const recent = [...hist].sort((a, b) => b.date.localeCompare(a.date)).slice(0, window)

  const defs: Array<{ key: Bucket["label"]; icon: TkWeatherIcon; effect: number; test: (d: WeatherDay) => boolean }> = [
    { key: "Clear & mild", icon: "sun", effect: 8, test: (d) => !severeOrWet(d) && d.temp_high_f >= 65 && d.temp_high_f <= 88 },
    { key: "Cloudy", icon: "cloud", effect: 0, test: (d) => !severeOrWet(d) && (d.temp_high_f < 65 || d.temp_high_f > 88) },
    { key: "Wet", icon: "rain", effect: -20, test: (d) => wet(d) && !d.is_severe },
    { key: "Severe", icon: "storm", effect: -32, test: (d) => d.is_severe },
  ]

  const buckets: Bucket[] = []
  const used = new Set<string>()
  for (const def of defs) {
    const matched = recent.filter((d) => !used.has(d.date) && def.test(d))
    matched.forEach((d) => used.add(d.date))
    if (matched.length > 0) {
      buckets.push({ label: def.key, icon: def.icon, count: matched.length, effectPct: def.effect })
    }
  }
  return { buckets, window }
}

function wet(d: WeatherDay): boolean {
  const c = (d.weather_condition ?? "").toLowerCase()
  return c.includes("rain") || c.includes("drizzle") || c.includes("snow") || c.includes("storm") || d.precipitation_in > 0.2
}
function severeOrWet(d: WeatherDay): boolean {
  return d.is_severe || wet(d)
}

export function WeatherDemandCorrelation({ days }: { days: WeatherDay[] }) {
  const { buckets, window } = bucketHistory(days)
  if (buckets.length < 2 || window < 5) return null

  const rows = buckets.map((b) => {
    const mag = Math.min(100, Math.abs(b.effectPct) * 2.4)
    const sign = b.effectPct > 0 ? "+" : b.effectPct < 0 ? "−" : "±"
    return {
      label: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          {b.label}
          <span className="tk-mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{b.count}d</span>
        </span>
      ) as ReactNode,
      width: mag,
      value: b.effectPct === 0 ? "Flat" : `${sign}${Math.abs(b.effectPct)}%`,
      tone: (b.effectPct <= -25 ? "bad" : b.effectPct < 0 ? "warn" : "ok") as "bad" | "warn" | "ok",
      tip: `${b.label} days, estimated walk-in vs a clear-day baseline`,
      tipValue: b.effectPct === 0 ? "About average" : `${sign}${Math.abs(b.effectPct)}% estimated`,
    }
  })

  return (
    <TkCard>
      <div className="tk-corr-head">
        <div className="tk-eyebrow">How weather moved your foot traffic</div>
        <p className="tk-corr-sub">
          Estimated walk-in effect by condition over the last {window} days, against a clear-day baseline.
          Directional — modeled from conditions, not measured covers.
        </p>
      </div>
      <TkSentimentRows
        rows={rows}
        caption="Estimated walk-in vs clear-day baseline"
        captionRight={`${window}-day window`}
      />
      <p className="tk-corr-foot">
        We adjust your daily brief and traffic insights when severe or wet weather is likely to suppress walk-in demand.
      </p>
    </TkCard>
  )
}

/* ════════════════════════════════════════════════════════════════════
   WeatherActionPlays — the "what this means" recommendations, rebuilt as
   TkPlayCards (icon + summary + a checklist of moves). Analysis ported verbatim
   from components/weather/weather-actionable-insights.tsx.
   ════════════════════════════════════════════════════════════════════ */
type ActionPlay = {
  icon: TkWeatherIcon | "trend"
  title: string
  summary: string
  tone: "down" | "warn" | "up" | "flat"
  actions: string[]
}

function buildActionPlays(days: WeatherDay[]): ActionPlay[] {
  const out: ActionPlay[] = []
  const forecast = days.filter((d) => d.isForecast).sort((a, b) => a.date.localeCompare(b.date))
  const historical = days.filter((d) => !d.isForecast).sort((a, b) => b.date.localeCompare(a.date))
  if (forecast.length === 0 && historical.length === 0) return out

  const coldDays = forecast.filter((d) => d.temp_low_f < 40)
  if (coldDays.length >= 2) {
    const lowest = Math.min(...coldDays.map((d) => d.temp_low_f))
    out.push({
      icon: "cloud",
      title: "Cold snap approaching",
      summary: `${coldDays.length} upcoming days with lows below 40°F (lowest ${Math.round(lowest)}°F). Walk-in traffic typically softens and demand shifts to warm items.`,
      tone: "warn",
      actions: [
        "Increase hot beverage and soup stock",
        "Add heat lamps or heaters to any outdoor area",
        "Promote warm comfort specials on social",
        "Trim staffing for the slower windows",
      ],
    })
  }

  let streak = 0
  let maxStreak = 0
  for (const d of forecast) {
    const cond = (d.weather_condition ?? "").toLowerCase()
    if (cond.includes("rain") || cond.includes("drizzle") || cond.includes("snow") || cond.includes("storm") || d.precipitation_in > 0.2) {
      streak++
      maxStreak = Math.max(maxStreak, streak)
    } else {
      streak = 0
    }
  }
  if (maxStreak >= 3) {
    out.push({
      icon: "rain",
      title: "Extended rain ahead",
      summary: `${maxStreak} consecutive rainy days in the forecast. Walk-in traffic typically drops 15–30% during prolonged wet weather.`,
      tone: "down",
      actions: [
        "Boost delivery / takeout promotions",
        "Make sure takeout packaging is rain-proof",
        "Run a rainy-day special to pull dine-in",
        "Lean social into the cozy indoor angle",
      ],
    })
  }

  const weekend = forecast.filter((d) => {
    const dow = new Date(d.date + "T12:00:00Z").getDay()
    return dow === 0 || dow === 6
  })
  const warmWeekend = weekend.filter((d) => d.temp_high_f >= 70 && d.precipitation_in < 0.1 && !d.is_severe)
  if (warmWeekend.length > 0) {
    const warm = warmWeekend[0]
    const dayName = new Date(warm.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long" })
    out.push({
      icon: "sun",
      title: `Beautiful ${dayName} forecast`,
      summary: `${dayName} looks ${Math.round(warm.temp_high_f)}°F and ${warm.weather_condition?.toLowerCase() ?? "clear"}. Strong conditions for outdoor dining and higher walk-in.`,
      tone: "up",
      actions: [
        "Open and prep patio / outdoor seating early",
        "Schedule extra weekend staff",
        "Post outdoor dining photos to social",
        "Plan an outdoor-friendly special",
      ],
    })
  }

  if (historical.length >= 14) {
    const recentAvg = historical.slice(0, 7).reduce((s, d) => s + d.temp_high_f, 0) / 7
    const prevAvg = historical.slice(7, 14).reduce((s, d) => s + d.temp_high_f, 0) / 7
    const diff = recentAvg - prevAvg
    if (Math.abs(diff) >= 10) {
      const warming = diff > 0
      out.push({
        icon: "trend",
        title: `Seasonal ${warming ? "warming" : "cooling"} trend`,
        summary: `Average highs shifted ${Math.abs(Math.round(diff))}°F ${warming ? "warmer" : "cooler"} this week vs last. Seasonal turns move both menu mix and traffic patterns.`,
        tone: "flat",
        actions: warming
          ? [
              "Rotate toward lighter, seasonal items",
              "Feature refreshing drinks and frozen desserts",
              "Prep outdoor seating for rising demand",
            ]
          : [
              "Feature hearty, warming items (soups, stews)",
              "Stock seasonal comfort-food ingredients",
              "Promote the cozy indoor atmosphere",
            ],
      })
    }
  }

  const severe = forecast.filter((d) => d.is_severe)
  if (severe.length > 0) {
    const s = severe[0]
    const dayName = new Date(s.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    out.push({
      icon: "storm",
      title: "Severe weather warning",
      summary: `Severe conditions forecast for ${dayName}: ${s.weather_condition ?? "severe weather"}, high of ${Math.round(s.temp_high_f)}°F.`,
      tone: "down",
      actions: [
        "Confirm delivery-partner availability",
        "Plan for possible early close / reduced hours",
        "Pre-warn customers via social and email",
        "Make sure staff safety plans are set",
      ],
    })
  }

  return out
}

const ACTION_GLYPH: Record<ActionPlay["icon"], ReactNode> = {
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
  trend: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 17l6-6 4 4 7-7M14 8h5v5" />
    </svg>
  ),
}

// The 4 tones → the 5 kit families that themed the icon tiles + chip.
const TONE_FAMILY = {
  down: "reputation",
  warn: "menu",
  up: "social",
  flat: "competitive",
} as const

const TONE_CHIP: Record<ActionPlay["tone"], string> = {
  down: "Watch",
  warn: "Heads up",
  up: "Opportunity",
  flat: "Trend",
}

export function WeatherActionPlays({ days }: { days: WeatherDay[] }) {
  const plays = buildActionPlays(days)
  if (plays.length === 0) return null
  return (
    <>
      <TkSectionHead title="What this means" sub="Estimated moves from the forecast" />
      <div className="tk-grid tk-weather-plays">
        {plays.map((p, i) => (
        <TkPlayCard
          key={i}
          family={TONE_FAMILY[p.tone]}
          icon={ACTION_GLYPH[p.icon]}
          title={p.title}
          summary={p.summary}
          chips={<TkChip family={TONE_FAMILY[p.tone]}>{TONE_CHIP[p.tone]}</TkChip>}
        >
          <ul className="tk-weather-checklist">
            {p.actions.map((a, j) => (
              <li key={j}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M13 7l5 5-5 5M18 12H6" />
                </svg>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </TkPlayCard>
        ))}
      </div>
    </>
  )
}

/* ════════════════════════════════════════════════════════════════════
   LocationWeatherTiles — per-location current conditions, rebuilt as kit cards
   with an animated temp-range meter. (Replaces components/weather/location-weather-cards.)
   ════════════════════════════════════════════════════════════════════ */
function LocationTile({ loc }: { loc: LocationWeather }) {
  const { ref, inView } = useInView<HTMLDivElement>()
  const icon = toTkWeatherIcon(loc.weather_condition, loc.is_severe)
  // meter: where the high sits across a 20–100°F comfort scale
  const pct = Math.max(4, Math.min(100, ((loc.temp_high_f - 20) / 80) * 100))
  return (
    <div ref={ref} className={`tk-loc-tile${loc.is_severe ? " tk-loc-severe" : ""}`}>
      <div className="tk-loc-top">
        <div className="tk-loc-meta">
          <p className="tk-loc-name">{loc.location_name}</p>
          <p className="tk-loc-date tk-mono">
            {new Date(loc.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </p>
        </div>
        <span className={`tk-loc-ic tk-${icon}-ic`} aria-hidden="true">
          {ACTION_GLYPH[icon]}
        </span>
      </div>
      <div className="tk-loc-temps">
        <span className="tk-loc-hi tk-mono">{Math.round(loc.temp_high_f)}°</span>
        <span className="tk-loc-lo tk-mono">/ {Math.round(loc.temp_low_f)}°</span>
      </div>
      <p className="tk-loc-cond">{loc.weather_condition.toLowerCase()}</p>
      <div className="tk-loc-meter" aria-hidden="true">
        <i style={{ width: inView ? `${pct}%` : 0 }} />
      </div>
      <div className="tk-loc-stats tk-mono">
        {loc.humidity_avg != null && <span>Hum {loc.humidity_avg}%</span>}
        {loc.wind_speed_max_mph != null && <span>Wind {Math.round(loc.wind_speed_max_mph)}mph</span>}
        {loc.precipitation_in > 0 && <span className="tk-loc-precip">{loc.precipitation_in}&quot; rain</span>}
      </div>
      {loc.is_severe && (
        <div className="tk-loc-alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          Severe weather
        </div>
      )}
    </div>
  )
}

export function LocationWeatherTiles({ locations }: { locations: LocationWeather[] }) {
  if (locations.length <= 1) return null
  return (
    <TkSoftPanel>
      <div className="tk-eyebrow" style={{ marginBottom: 14 }}>All locations · now</div>
      <div className="tk-loc-grid">
        {locations.map((loc) => (
          <LocationTile key={loc.location_id} loc={loc} />
        ))}
      </div>
    </TkSoftPanel>
  )
}
