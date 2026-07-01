import { describe, it, expect } from "vitest"
import { workingHoursToLines } from "@/lib/providers/outscraper"
import { parseWeekdayDescriptions } from "@/lib/competitors/open-hours"

// ALT-264 — the busy-times pull carries the place's posted hours; these lines must
// round-trip through the open-hours parser so "Who's open when" can render them.

describe("providers/outscraper · workingHoursToLines", () => {
  it("turns the day-keyed object into 'Day: span' lines", () => {
    expect(
      workingHoursToLines({ Monday: "11AM-10PM", Tuesday: "Open 24 hours" }),
    ).toEqual(["Monday: 11AM-10PM", "Tuesday: Open 24 hours"])
  })

  it("joins array spans (split shifts) into one comma line", () => {
    expect(workingHoursToLines({ Friday: ["7AM-2PM", "5PM-10PM"] })).toEqual([
      "Friday: 7AM-2PM, 5PM-10PM",
    ])
  })

  it("skips unusable values and returns null when nothing is left", () => {
    expect(workingHoursToLines({ Monday: "", Tuesday: 7, Wednesday: null })).toBeNull()
    expect(workingHoursToLines(null)).toBeNull()
    expect(workingHoursToLines("11AM-10PM")).toBeNull()
    expect(workingHoursToLines(["11AM-10PM"])).toBeNull()
  })

  it("round-trips through the open-hours parser (compact AM/PM, no space)", () => {
    const lines = workingHoursToLines({ Monday: "11AM-10PM", Sunday: "Closed" })
    const byDay = parseWeekdayDescriptions(lines)
    expect(byDay[1]).toEqual({
      known: true,
      open: true,
      is24h: false,
      intervals: [{ start: 11, end: 22 }],
    })
    expect(byDay[0]).toEqual({ known: true, open: false, is24h: false, intervals: [] })
  })
})
