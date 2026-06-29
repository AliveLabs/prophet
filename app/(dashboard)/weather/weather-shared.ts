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
