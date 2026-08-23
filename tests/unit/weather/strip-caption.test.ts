// ALT-718 — the "Next 7" strip captioned a week of PAST weather as the week ahead.
//
// The strip tops itself up from recent history when the forecast is short, which is a good idea and
// stays. The bug was the label: the caption said "Next 7" unconditionally, so when `fetchForecast`
// threw and `forecastDays` came back empty, the strip filled with the seven most recent past days
// and presented them as the forecast. An operator planning staffing off that is planning off last
// week.
//
// Two halves. The caption was fixed in the page. The cells were not: each one renders nothing but a
// weekday abbreviation, so in the MIXED case ("Next 3 + recent history") four of seven cells are
// history and look identical to the three that are not. The caption tells you the shape; it cannot
// tell you which.
//
// This logic lived inside a page component, where `vitest` could never reach it (it collects
// `tests/unit/**/*.test.ts` and no `.tsx`). The one decision that was quietly wrong was the one
// that could not be asserted. Extracted for that reason.

import { describe, expect, it } from "vitest"
import { describeStripDays, shouldMarkAsPast } from "@/lib/weather/strip-caption"

const fc = (n: number) => Array.from({ length: n }, () => ({ isForecast: true }))
const hist = (n: number) => Array.from({ length: n }, () => ({ isForecast: false }))

describe("the failure this ticket is about", () => {
  it("does NOT say 'Next 7' when every day is history", () => {
    // The exact shape when fetchForecast throws: forecastDays is [], the top-up fills all seven.
    const d = describeStripDays(hist(7))
    expect(d.caption).not.toMatch(/next/i)
    expect(d.caption).toMatch(/last 7 days/i)
    // And it says WHY, so it reads as a known gap rather than a broken page.
    expect(d.caption).toMatch(/forecast unavailable/i)
    expect(d.isAllHistory).toBe(true)
    expect(d.forecastCount).toBe(0)
  })

  it("says 'Next 7' only when all seven really are forecast", () => {
    const d = describeStripDays(fc(7))
    expect(d.caption).toMatch(/^Next 7 /)
    expect(d.isAllHistory).toBe(false)
    expect(d.isMixed).toBe(false)
  })

  it("names the real count when the strip is mixed", () => {
    // 3 forecast days topped up with 4 of history. Saying "Next 7" here is the same lie, smaller.
    const d = describeStripDays([...hist(4), ...fc(3)])
    expect(d.caption).toMatch(/^Next 3 \+ recent history/)
    expect(d.forecastCount).toBe(3)
    expect(d.isMixed).toBe(true)
  })

  it("counts forecast days wherever they sit in the array", () => {
    // The page builds the array history-first, but nothing should depend on the ordering.
    expect(describeStripDays([...fc(2), ...hist(5)]).forecastCount).toBe(2)
    expect(describeStripDays([...hist(3), ...fc(2), ...hist(2)]).forecastCount).toBe(2)
  })
})

describe("cell marking: only where the caption cannot disambiguate", () => {
  it("marks the history cells in a MIXED strip", () => {
    const days = [...hist(4), ...fc(3)]
    const d = describeStripDays(days)
    const marked = days.map((day) => shouldMarkAsPast(day, d))
    expect(marked).toEqual([true, true, true, true, false, false, false])
  })

  it("marks NOTHING in an all-history strip, because the caption already says so in words", () => {
    // Marking all seven would read as an error state rather than a caveat on real data.
    const days = hist(7)
    const d = describeStripDays(days)
    expect(days.every((day) => shouldMarkAsPast(day, d) === false)).toBe(true)
  })

  it("marks nothing in an all-forecast strip, because there is nothing to distinguish", () => {
    const days = fc(7)
    const d = describeStripDays(days)
    expect(days.every((day) => shouldMarkAsPast(day, d) === false)).toBe(true)
  })
})

describe("it does not treat a missing flag as a forecast", () => {
  it("undefined and null both count as NOT forecast", () => {
    // Fail toward "this is history": claiming a day is forecast when we do not know is the exact
    // direction of the original bug.
    expect(describeStripDays([{}, {}, {}]).forecastCount).toBe(0)
    expect(describeStripDays([{ isForecast: null }]).forecastCount).toBe(0)
    expect(describeStripDays([{ isForecast: undefined }]).isAllHistory).toBe(true)
  })

  it("only a literal true counts", () => {
    expect(describeStripDays([{ isForecast: false }]).forecastCount).toBe(0)
    expect(describeStripDays([{ isForecast: true }]).forecastCount).toBe(1)
  })
})

describe("degenerate inputs do not produce a false claim", () => {
  it("an empty strip is not 'all history' and not a forecast", () => {
    // The page guards on stripDays.length > 0 before rendering, so this is defensive. It must not
    // claim a forecast either way.
    const d = describeStripDays([])
    expect(d.isAllHistory).toBe(false)
    expect(d.isMixed).toBe(false)
    expect(d.forecastCount).toBe(0)
  })

  it("a single forecast day does not get captioned as seven", () => {
    // "Next 7" on one day of data was the original class of overclaim.
    const d = describeStripDays(fc(1))
    expect(d.isMixed).toBe(false)
    // All-forecast, so the standard caption applies; the count is what the cells show.
    expect(d.forecastCount).toBe(1)
  })
})
