// ALT-628 / ALT-635 — a forecast may only be stated as strongly as it is held.
//
// The bug these lock down: OpenWeather's DAILY `weather[0]` names the most significant condition
// that MAY occur, so a day with a 6% chance of a passing shower comes back `main: "Rain"`. We
// rendered that verbatim, counted it into a "consecutive rainy days" streak, and told an operator
// to expect four days of rain across a week that was 0-6% chance throughout. `pop` was in the
// response the whole time and was never read.

import { describe, it, expect } from "vitest"
import {
  resolveForecastCondition,
  isPrecipitationCondition,
  WET_LABEL_MIN_CHANCE_PCT,
  SEVERE_MIN_CHANCE_PCT,
  type ForecastConditionInput,
} from "@/lib/providers/openweathermap"

const RAIN = { id: 500, main: "Rain", description: "light rain", icon: "10d" }
const THUNDER = { id: 202, main: "Thunderstorm", description: "thunderstorm with heavy rain", icon: "11d" }
const CLEAR = { id: 800, main: "Clear", description: "clear sky", icon: "01d" }

function day(over: Partial<ForecastConditionInput> = {}): ForecastConditionInput {
  return {
    reported: RAIN,
    chancePct: 6,
    precipMm: 0.2,
    cloudCoverPct: 40,
    tempMinC: 18,
    tempHighF: 88,
    tempLowF: 66,
    ...over,
  }
}

describe("resolveForecastCondition", () => {
  it("does NOT call a 6%-chance day rain — the reported label is downgraded to the sky we can vouch for", () => {
    const out = resolveForecastCondition(day())
    expect(out.condition).toBe("Clouds")
    expect(isPrecipitationCondition(out.condition)).toBe(false)
    expect(out.icon).not.toBe("10d")
  })

  it("keeps the rain label once the chance clears the bar", () => {
    const out = resolveForecastCondition(day({ chancePct: WET_LABEL_MIN_CHANCE_PCT }))
    expect(out.condition).toBe("Rain")
    expect(out.description).toBe("light rain")
  })

  it("holds the line one point below the bar", () => {
    const out = resolveForecastCondition(day({ chancePct: WET_LABEL_MIN_CHANCE_PCT - 1 }))
    expect(out.condition).toBe("Clouds")
  })

  it("real accumulation overrides a low stated chance", () => {
    // 2mm is a wet day whatever the stated probability says.
    const out = resolveForecastCondition(day({ chancePct: 5, precipMm: 3 }))
    expect(out.condition).toBe("Rain")
  })

  it("clear stays clear — a non-precipitation label is never touched", () => {
    const out = resolveForecastCondition(day({ reported: CLEAR, chancePct: 0, precipMm: 0 }))
    expect(out.condition).toBe("Clear")
  })

  it("describes the downgraded day by cloud cover, not by a wetter guess", () => {
    expect(resolveForecastCondition(day({ cloudCoverPct: 90 })).description).toBe("overcast clouds")
    expect(resolveForecastCondition(day({ cloudCoverPct: 5 })).condition).toBe("Clear")
  })

  it("with no stated chance, falls back to accumulation (the historical path's behaviour)", () => {
    expect(resolveForecastCondition(day({ chancePct: null, precipMm: 0.2 })).condition).toBe("Rain")
    expect(resolveForecastCondition(day({ chancePct: null, precipMm: 0 })).condition).toBe("Clouds")
  })

  describe("severe", () => {
    it("does not raise a severe alert on a low-chance thunderstorm", () => {
      const out = resolveForecastCondition(day({ reported: THUNDER, chancePct: 6 }))
      expect(out.isSevere).toBe(false)
    })

    it("raises it once the storm is more likely than not", () => {
      const out = resolveForecastCondition(day({ reported: THUNDER, chancePct: SEVERE_MIN_CHANCE_PCT }))
      expect(out.isSevere).toBe(true)
    })

    it("needs a higher bar than the rain label does", () => {
      // A chance that is enough to SAY rain is not automatically enough to raise an alert.
      const between = resolveForecastCondition(day({ reported: THUNDER, chancePct: WET_LABEL_MIN_CHANCE_PCT }))
      expect(between.condition).toBe("Thunderstorm")
      expect(between.isSevere).toBe(false)
    })

    it("temperature extremes are not probabilistic and still flag on their own", () => {
      expect(resolveForecastCondition(day({ reported: CLEAR, tempHighF: 110 })).isSevere).toBe(true)
      expect(resolveForecastCondition(day({ reported: CLEAR, tempLowF: 5 })).isSevere).toBe(true)
    })
  })

  it("survives a response with no condition block at all", () => {
    const out = resolveForecastCondition(day({ reported: undefined }))
    expect(out.condition).toBe("Unknown")
    expect(out.isSevere).toBe(false)
  })
})

describe("isPrecipitationCondition", () => {
  it("recognises every wet label OpenWeather emits", () => {
    for (const c of ["Rain", "Drizzle", "Snow", "Sleet", "Thunderstorm", "Squall"]) {
      expect(isPrecipitationCondition(c)).toBe(true)
    }
  })

  it("does not treat a dry sky as wet", () => {
    for (const c of ["Clear", "Clouds", "Mist", "Haze", "", "  "]) {
      expect(isPrecipitationCondition(c)).toBe(false)
    }
  })
})
