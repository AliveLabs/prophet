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

// ── ALT-768 / ALT-769 ───────────────────────────────────────────────────────────────────────
//
// Both found on 2026-08-22 while answering a question about what kind of day local businesses had
// on Tuesday 08-18. Nobody was looking for either.
//
// ALT-768. The summary said "conditions today (108°F, …)", which reads as a MEASUREMENT of today.
// It is a forecast high captured at about 06:30 that morning. Measured against prod for Raising
// Cane's, the number the insight quoted ran 1.1 to 2.2°F HOTTER than what `location_weather` held
// for the same date on 4 of the 5 most recent firings:
//
//   date        location_weather   insight    delta
//   2026-08-16  103.7              105.5      +1.8
//   2026-08-17  105.2              106.3      +1.1
//   2026-08-18  105.4              107.6      +2.2
//   2026-08-19  104.9              107.0      +2.1
//   2026-08-20  108.2              108.2       0.0   <- matches
//
// THE ROOT CAUSE IS NOT WHAT THE TICKET GUESSED. It supposed the detector took a max over the
// forecast horizon. It does not: the persisted row and the insight both read the same
// `ctx.state.todayWeather` object in the same run, milliseconds apart, so they cannot disagree at
// write time. What actually happens is that `location_weather` holds ONE row per (location, date)
// and the pipeline writes it TWICE with two different meanings: a FORECAST on the day, then an
// OBSERVATION when the next day's run fetches "yesterday" and upserts the same key. The insight
// quotes the forecast; the row later becomes the observation.
//
// 08-20 matches for a reason that confirms it: there are no `location_weather` rows at all after
// 08-20 for that location, so no following run ever overwrote it. It is still the forecast.
//
// So the number was not wrong. The SENTENCE was. "Should reach" is what we can support, which is
// how the patio insight in the same file had always phrased it.
describe("ALT-768 — the temperature is a forecast and must not be stated as a measurement", () => {
  const severe = (over: Partial<DailyWeatherSummary> = {}) =>
    generateWeatherCrossSignals(
      { today: day({ is_severe: true, temp_high_f: 105.4, ...over }), yesterday: null, weekAvg: null },
      false,
    ).find((i) => i.insight_type === "traffic.weather_suppression")!

  it("phrases the high as a forecast, not as a reading", () => {
    const s = severe().summary
    expect(s).toMatch(/should reach/i)
    // The old phrasing asserted it as fact about today.
    expect(s).not.toMatch(/conditions today \(/)
  })

  it("labels the number's provenance in evidence, so a later reader can tell what it was", () => {
    // The row it would be compared against changes meaning the next day. Without this field there
    // is no way to know the insight quoted the forecast.
    expect(severe().evidence.temp_source).toBe("forecast")
  })

  it("still quotes the number it was given, rounded", () => {
    expect(severe({ temp_high_f: 107.6 }).summary).toContain("108°F")
    expect(severe({ temp_high_f: 107.6 }).evidence.temp_high).toBe(107.6)
  })

  it("says precipitation is forecast too, since it comes off the same row", () => {
    expect(severe({ precipitation_in: 0.4 }).summary).toMatch(/precipitation forecast/i)
  })
})

// ALT-769. The advice was ONE fixed string: "emphasize delivery options and cozy atmosphere".
// Every `is_severe` day in prod so far has been HEAT, so the only advice we ever shipped was the
// one that could not apply. Telling a Texas operator to be "cozy" at 105°F is the kind of line
// that says we have never seen their restaurant.
describe("ALT-769 — severe weather is not always cold", () => {
  const adviceFor = (over: Partial<DailyWeatherSummary>) =>
    generateWeatherCrossSignals(
      { today: day({ is_severe: true, ...over }), yesterday: null, weekAvg: null },
      false,
    ).find((i) => i.insight_type === "traffic.weather_suppression")!.recommendations[0]!

  it("never says cozy on a hot day, and does say something about heat", () => {
    const a = adviceFor({ temp_high_f: 105.4 })
    expect(JSON.stringify(a)).not.toMatch(/cozy/i)
    expect(JSON.stringify(a)).toMatch(/heat|iced|air-conditioned/i)
  })

  it("gives warm-food advice on a genuinely cold day", () => {
    expect(JSON.stringify(adviceFor({ temp_high_f: 28 }))).toMatch(/warm|soup|hot/i)
  })

  it("leads on rain when it is wet, whatever the temperature", () => {
    // Precipitation is checked first: a wet 100°F day and a wet 35°F day get the same message.
    for (const t of [100, 35]) {
      expect(JSON.stringify(adviceFor({ temp_high_f: t, precipitation_in: 0.6 })), `${t}F`).toMatch(/wet|curbside/i)
    }
  })

  it("has something true to say when severe means wind or storms, not temperature", () => {
    const a = adviceFor({ temp_high_f: 68, weather_condition: "Squall" })
    expect(JSON.stringify(a)).toMatch(/whatever the temperature/i)
    expect(JSON.stringify(a)).not.toMatch(/cozy|heat this severe/i)
  })

  it("never serves the wrong branch, which is the actual failure mode", () => {
    // Asserted on branch IDENTITY, not on keywords. My first version of this test failed on "Lead
    // with cold drinks" for a hot day, because it matched the bare word "cold" -- which is correct
    // copy in heat. The bug was never a word appearing, it was the wrong branch being chosen.
    const hot = adviceFor({ temp_high_f: 105 })
    const cold = adviceFor({ temp_high_f: 28 })
    const wet = adviceFor({ temp_high_f: 105, precipitation_in: 0.6 })
    const other = adviceFor({ temp_high_f: 68 })
    const titles = [hot.title, cold.title, wet.title, other.title]
    // Four distinct conditions, four distinct pieces of advice. The bug was one string for all.
    expect(new Set(titles).size).toBe(4)
    expect(hot.title).not.toBe(cold.title)
  })
})

describe("the customer-facing strings carry no em dashes", () => {
  it("title and summary are clean", () => {
    const ins = generateWeatherCrossSignals(
      { today: day({ is_severe: true, temp_high_f: 105 }), yesterday: null, weekAvg: null },
      false,
    )
    for (const i of ins) {
      expect(i.title, i.insight_type).not.toMatch(/[—–]/)
      expect(i.summary, i.insight_type).not.toMatch(/[—–]/)
    }
  })
})
