import { describe, it, expect } from "vitest"
import { isPatioFavorable, generateWeatherCrossSignals, type WeatherContext } from "@/lib/insights/weather-context"
import type { DailyWeatherSummary } from "@/lib/providers/openweathermap"

function day(overrides: Partial<DailyWeatherSummary> = {}): DailyWeatherSummary {
  return {
    date: "2026-06-26",
    temp_high_f: 75,
    temp_low_f: 60,
    feels_like_high_f: 76,
    humidity_avg: 50,
    wind_speed_max_mph: 8,
    weather_condition: "Clear",
    weather_description: "clear sky",
    weather_icon: "01d",
    precipitation_in: 0,
    is_severe: false,
    ...overrides,
  } as DailyWeatherSummary
}

describe("isPatioFavorable", () => {
  it("true in the comfortable band, dry, not severe", () => {
    expect(isPatioFavorable(day({ temp_high_f: 78 }))).toBe(true)
  })
  it("false in a heatwave (a 100F patio is miserable, not an opportunity)", () => {
    expect(isPatioFavorable(day({ temp_high_f: 100 }))).toBe(false)
  })
  it("false when too cold, raining, or severe", () => {
    expect(isPatioFavorable(day({ temp_high_f: 50 }))).toBe(false)
    expect(isPatioFavorable(day({ precipitation_in: 0.3 }))).toBe(false)
    expect(isPatioFavorable(day({ is_severe: true }))).toBe(false)
  })
})

describe("generateWeatherCrossSignals — patio gate", () => {
  const patioToday = day({ temp_high_f: 78 })

  it("does NOT fire on ordinary warmth when the whole week is also pleasant (no notable break)", () => {
    const ctx: WeatherContext = {
      today: patioToday,
      yesterday: day({ temp_high_f: 79 }), // yesterday also patio-favorable
      weekAvg: { temp_high_f: 80, precipitation_in: 0 }, // week is pleasant too
    }
    const out = generateWeatherCrossSignals(ctx, true)
    expect(out.some((i) => i.insight_type === "visual.weather_patio")).toBe(false)
  })

  it("FIRES on a pleasant break after a heatwave week", () => {
    const ctx: WeatherContext = {
      today: patioToday,
      yesterday: day({ temp_high_f: 99 }),
      weekAvg: { temp_high_f: 98, precipitation_in: 0 }, // week was a heatwave
    }
    const out = generateWeatherCrossSignals(ctx, true)
    expect(out.some((i) => i.insight_type === "visual.weather_patio")).toBe(true)
  })

  it("FIRES when yesterday was not patio weather (a break) even without a week baseline", () => {
    const ctx: WeatherContext = {
      today: patioToday,
      yesterday: day({ is_severe: true }),
      weekAvg: null,
    }
    expect(generateWeatherCrossSignals(ctx, true).some((i) => i.insight_type === "visual.weather_patio")).toBe(true)
  })

  it("never fires without patio photos", () => {
    const ctx: WeatherContext = { today: patioToday, yesterday: day({ temp_high_f: 99 }), weekAvg: { temp_high_f: 98, precipitation_in: 0 } }
    expect(generateWeatherCrossSignals(ctx, false).some((i) => i.insight_type === "visual.weather_patio")).toBe(false)
  })

  it("never fires in a heatwave (today too hot for a patio), even off a hot baseline", () => {
    const ctx: WeatherContext = {
      today: day({ temp_high_f: 101 }),
      yesterday: day({ temp_high_f: 100 }),
      weekAvg: { temp_high_f: 99, precipitation_in: 0 },
    }
    expect(generateWeatherCrossSignals(ctx, true).some((i) => i.insight_type === "visual.weather_patio")).toBe(false)
  })

  it("stays silent with no baseline at all (avoids daily 'it's nice out' spam)", () => {
    const ctx: WeatherContext = { today: patioToday, yesterday: null, weekAvg: null }
    expect(generateWeatherCrossSignals(ctx, true).some((i) => i.insight_type === "visual.weather_patio")).toBe(false)
  })
})
