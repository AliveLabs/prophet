// Server-safe weather helpers + shared types.
//
// These pure functions and types are used by BOTH the Weather server component
// (./page.tsx) and its client islands (./weather-client.tsx). They MUST live
// outside the "use client" module: a Server Component cannot CALL a function that
// is exported from a "use client" file — React throws at runtime ("Attempted to
// call toTkWeatherIcon() from the server but it is on the client. It can only be
// rendered as a Component."). Keeping them in this plain (non-client) module lets
// the server page import and call them directly, while the client islands import
// them too. No "use client" directive here on purpose.

import type { TkWeatherIcon, TkDemand } from "@/components/ticket"

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
  /** Chance of precipitation 0-100 on forecast days; null on days that already happened. */
  precipitation_chance_pct?: number | null
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

/** Below this chance we do not treat a forecast day as wet. Mirrors WET_LABEL_MIN_CHANCE_PCT. */
const WET_MIN_CHANCE_PCT = 30

/**
 * Is this day wet enough to move demand?
 *
 * ALT-628/635: the condition label alone used to decide this, and OpenWeather labels a 6%-chance
 * day "Rain". That marked four dry days "down" in a row. The provider now resolves the label
 * honestly, and this is the second gate: when we have a stated chance, it has to clear the bar.
 * Real accumulation still counts on its own, and a day with no stated chance (one that already
 * happened) is judged the way it always was.
 */
export function isWetDay(d: WeatherDay): boolean {
  if (d.precipitation_in > 0.2) return true
  const chance = d.precipitation_chance_pct
  if (typeof chance === "number" && chance < WET_MIN_CHANCE_PCT) return false
  const c = (d.weather_condition ?? "").toLowerCase()
  return c.includes("rain") || c.includes("drizzle") || c.includes("snow") || c.includes("storm")
}

// Honest demand estimate from conditions — NOT a measured number. Mirrors the
// directional language already used in the actionable-insights copy: harsh weather
// pulls walk-in down, mild/clear weekend warmth lifts it, everything else is flat.
export function estimateDemand(d: WeatherDay): TkDemand {
  const c = (d.weather_condition ?? "").toLowerCase()
  if (d.is_severe || c.includes("thunder")) return "down"
  if (isWetDay(d)) return "down"
  if (d.temp_low_f < 35 || d.temp_high_f > 98) return "down"
  const dow = new Date(d.date + "T12:00:00Z").getDay()
  const isWeekend = dow === 0 || dow === 6
  if (d.temp_high_f >= 68 && d.temp_high_f <= 88 && d.precipitation_in < 0.05) {
    return isWeekend ? "up" : "flat"
  }
  return "flat"
}

// Composite (weather + events) demand — the honest read Concept A shows on the
// strip: a notable nearby event is a walk-in tailwind, so it can lift a "flat"
// weather day to "up". It does NOT rescue a day weather is actively suppressing
// (severe / wet / extreme): we don't claim an event beats a thunderstorm. Still
// directional/estimated — no covers/$/POS. `hasEvent` = a notable in-trade-area
// event lands on this day.
export function estimateDemandWithEvent(d: WeatherDay, hasEvent: boolean): TkDemand {
  const base = estimateDemand(d)
  if (!hasEvent) return base
  if (base === "down") return base // weather is suppressing; an event won't flip it
  return "up" // flat or up → an event night reads as a lift
}
