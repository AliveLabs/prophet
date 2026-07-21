import { describe, it, expect } from "vitest"
import {
  parseSpan,
  parseDayLine,
  parseWeekdayDescriptions,
  isOpenAtHour,
  openHourCount,
  openLabel,
  observedWindow,
  observedLabel,
} from "@/lib/competitors/open-hours"

describe("competitors/open-hours · parseSpan", () => {
  it("parses a standard AM/PM window into half-open hour cells", () => {
    // Open 10am, close 11pm ⇒ cells 10..22 open (the 11pm-midnight hour is closed).
    expect(parseSpan("10:00 AM – 11:00 PM")).toEqual({
      known: true,
      open: true,
      is24h: false,
      intervals: [{ start: 10, end: 23 }],
    })
  })

  it("treats 'Open 24 hours' as a full-day window", () => {
    expect(parseSpan("Open 24 hours")).toEqual({
      known: true,
      open: true,
      is24h: true,
      intervals: [{ start: 0, end: 24 }],
    })
  })

  it("marks 'Closed' as known-but-not-open", () => {
    expect(parseSpan("Closed")).toEqual({ known: true, open: false, is24h: false, intervals: [] })
  })

  it("parses a split shift (two windows) and merges nothing that doesn't touch", () => {
    expect(parseSpan("7:00 AM – 2:00 PM, 5:00 PM – 10:00 PM").intervals).toEqual([
      { start: 7, end: 14 },
      { start: 17, end: 22 },
    ])
  })

  it("clips an overnight window to the end of the day it's listed under", () => {
    // 5pm – 2am ⇒ close is not after open ⇒ runs to midnight on this day.
    expect(parseSpan("5:00 PM – 2:00 AM")).toEqual({
      known: true,
      open: true,
      is24h: false,
      intervals: [{ start: 17, end: 24 }],
    })
  })

  it("clips a just-past-midnight close to end-of-day (the tail is the next day's line)", () => {
    // 11:30 PM – 12:30 AM ⇒ close (30 min) is before open ⇒ overnight ⇒ this day ends at 24.
    expect(parseSpan("11:30 PM – 12:30 AM").intervals).toEqual([{ start: 23, end: 24 }])
  })

  it("merges overlapping windows (messy source) into one span", () => {
    expect(parseSpan("11:00 AM – 1:00 PM, 11:30 AM – 2:00 PM").intervals).toEqual([
      { start: 11, end: 14 },
    ])
  })

  it("handles a midnight close as end-of-day", () => {
    expect(parseSpan("11:00 AM – 12:00 AM").intervals).toEqual([{ start: 11, end: 24 }])
  })

  it("floors the open and ceils the close for half-hour edges", () => {
    // Open 6:30am lights the 6 o'clock cell; close 10:30pm lights the 10 o'clock cell.
    expect(parseSpan("6:30 AM – 10:30 PM").intervals).toEqual([{ start: 6, end: 23 }])
  })

  it("accepts hyphen, em dash, and the word 'to' as the range separator", () => {
    const want = { start: 9, end: 17 }
    expect(parseSpan("9:00 AM - 5:00 PM").intervals).toEqual([want])
    expect(parseSpan("9:00 AM — 5:00 PM").intervals).toEqual([want])
    expect(parseSpan("9 AM to 5 PM").intervals).toEqual([want])
  })

  it("tolerates narrow-no-break spaces and lowercase meridiems", () => {
    // Google emits a narrow no-break space (U+202F) before AM/PM.
    expect(parseSpan("8:00 am – 8:00 pm").intervals).toEqual([{ start: 8, end: 20 }])
  })

  it("returns 'unknown' for empty or unparseable input (never fabricates)", () => {
    for (const v of ["", "   ", null, undefined, "Hours not available", "see website"]) {
      expect(parseSpan(v as string).known).toBe(false)
    }
  })
})

// ALT-367 — Google and Outscraper state a single meridiem for a whole range, so the
// opening time arrives bare and used to default to AM (a dinner-only "5:00 - 10:30 PM"
// read as 5 AM, painting the wrong bar). The bare open must inherit the range meridiem.
describe("competitors/open-hours · shared-meridiem ranges (bare opening time)", () => {
  it("infers PM for a bare open when the close is PM (the Harvest dinner-only case)", () => {
    // Google weekdayDescriptions: "Tuesday: 5:00 – 10:30 PM" ⇒ 5 PM, not 5 AM.
    expect(parseSpan("5:00 – 10:30 PM").intervals).toEqual([{ start: 17, end: 23 }])
    expect(openLabel(parseSpan("5:00 – 10:30 PM"))).toBe("5 PM - 11 PM")
  })

  it("handles Outscraper's compact single-meridiem range", () => {
    // "5-10:30PM" ⇒ 5 PM - 10:30 PM.
    expect(parseSpan("5-10:30PM").intervals).toEqual([{ start: 17, end: 23 }])
    // "11AM-11PM" already has both meridiems and is unchanged.
    expect(parseSpan("11AM-11PM").intervals).toEqual([{ start: 11, end: 23 }])
  })

  it("picks the meridiem that keeps open before close (does NOT blindly copy the close)", () => {
    // "11 - 2 PM" is 11 AM - 2 PM (11 PM would be after the close).
    expect(parseSpan("11 - 2 PM").intervals).toEqual([{ start: 11, end: 14 }])
    // "9 - 5 PM" is 9 AM - 5 PM.
    expect(parseSpan("9 - 5 PM").intervals).toEqual([{ start: 9, end: 17 }])
  })

  it("still reads a true morning window when the close is AM", () => {
    // "6 - 11 AM" (breakfast) stays 6 AM - 11 AM.
    expect(parseSpan("6 - 11 AM").intervals).toEqual([{ start: 6, end: 11 }])
  })

  it("infers PM open for a bare overnight range ('5 - 2 AM' ⇒ 5 PM - 2 AM)", () => {
    // Bare open, AM close, open-after-close ⇒ open is PM; clipped to end-of-day here.
    expect(parseSpan("5 - 2 AM").intervals).toEqual([{ start: 17, end: 24 }])
  })

  it("leaves 24-hour times untouched (no false meridiem inference)", () => {
    // "13:00 - 22:00" is already unambiguous; must stay 13..22.
    expect(parseSpan("13:00 - 22:00").intervals).toEqual([{ start: 13, end: 22 }])
  })

  it("end-to-end: a full Harvest weekday line resolves to a PM dinner window", () => {
    const byDay = parseWeekdayDescriptions([
      "Monday: Closed",
      "Tuesday: 5:00 – 10:30 PM",
      "Friday: 5:00 PM – 12:00 AM",
      "Saturday: 10:30 AM – 2:30 PM, 5:00 PM – 12:00 AM",
    ])
    expect(byDay[2].intervals).toEqual([{ start: 17, end: 23 }]) // Tuesday 5 PM - 10:30 PM
    expect(openLabel(byDay[2])).toBe("5 PM - 11 PM")
    expect(byDay[5].intervals).toEqual([{ start: 17, end: 24 }]) // Friday explicit, unchanged
    expect(byDay[6].intervals).toEqual([
      { start: 10, end: 15 },
      { start: 17, end: 24 },
    ]) // Saturday split shift, both explicit
  })
})

describe("competitors/open-hours · parseDayLine", () => {
  it("splits on the FIRST colon only, keeping the time's own colon", () => {
    const { dow, hours } = parseDayLine("Monday: 10:00 AM – 11:00 PM")
    expect(dow).toBe(1)
    expect(hours.intervals).toEqual([{ start: 10, end: 23 }])
  })

  it("maps each English day name to a 0=Sunday index", () => {
    expect(parseDayLine("Sunday: Closed").dow).toBe(0)
    expect(parseDayLine("Saturday: Open 24 hours").dow).toBe(6)
  })

  it("falls back to span-only parse when there is no day prefix", () => {
    const { dow, hours } = parseDayLine("10:00 AM – 11:00 PM")
    expect(dow).toBeNull()
    expect(hours.open).toBe(true)
  })
})

describe("competitors/open-hours · parseWeekdayDescriptions", () => {
  const lines = [
    "Monday: 10:00 AM – 11:00 PM",
    "Tuesday: 10:00 AM – 11:00 PM",
    "Wednesday: Closed",
    "Thursday: 10:00 AM – 11:00 PM",
    "Friday: 10:00 AM – 12:00 AM",
    "Saturday: Open 24 hours",
    "Sunday: 8:00 AM – 2:00 PM",
  ]

  it("keys hours by day-of-week off the day NAME, not array order", () => {
    const byDay = parseWeekdayDescriptions(lines)
    expect(byDay[0].intervals).toEqual([{ start: 8, end: 14 }]) // Sunday
    expect(byDay[1].intervals).toEqual([{ start: 10, end: 23 }]) // Monday
    expect(byDay[3].open).toBe(false) // Wednesday is the closed one
    expect(byDay[4].open).toBe(true) // Thursday is open
    expect(byDay[5].intervals).toEqual([{ start: 10, end: 24 }]) // Friday midnight close
    expect(byDay[6].is24h).toBe(true) // Saturday
  })

  it("leaves unmentioned days absent (caller treats missing as unknown)", () => {
    const byDay = parseWeekdayDescriptions(["Monday: 9 AM – 5 PM"])
    expect(byDay[1].open).toBe(true)
    expect(byDay[0]).toBeUndefined()
  })

  it("returns an empty map for null/non-array input", () => {
    expect(parseWeekdayDescriptions(null)).toEqual({})
    expect(parseWeekdayDescriptions(undefined)).toEqual({})
  })
})

describe("competitors/open-hours · helpers", () => {
  it("isOpenAtHour respects half-open interval boundaries", () => {
    const day = parseSpan("10:00 AM – 11:00 PM") // [10, 23)
    expect(isOpenAtHour(day, 9)).toBe(false)
    expect(isOpenAtHour(day, 10)).toBe(true)
    expect(isOpenAtHour(day, 22)).toBe(true)
    expect(isOpenAtHour(day, 23)).toBe(false)
    expect(isOpenAtHour(undefined, 12)).toBe(false)
  })

  it("openHourCount sums all windows", () => {
    expect(openHourCount(parseSpan("7 AM – 2 PM, 5 PM – 10 PM"))).toBe(7 + 5)
    expect(openHourCount(parseSpan("Open 24 hours"))).toBe(24)
    expect(openHourCount(parseSpan("Closed"))).toBe(0)
  })

  it("openLabel renders plain language with a hyphen range (no en/em dash)", () => {
    expect(openLabel(parseSpan("10:00 AM – 11:00 PM"))).toBe("10 AM - 11 PM")
    expect(openLabel(parseSpan("Open 24 hours"))).toBe("Open 24 hours")
    expect(openLabel(parseSpan("Closed"))).toBe("Closed")
    expect(openLabel(parseSpan(""))).toBe("Hours unavailable")
    expect(openLabel(parseSpan("7 AM – 2 PM, 5 PM – 10 PM"))).toBe("7 AM - 2 PM, 5 PM - 10 PM")
    // No en/em dashes in the user-facing label (Ticket voice rule).
    expect(openLabel(parseSpan("9 AM – 5 PM"))).not.toMatch(/–|—/)
  })
})

// ALT-264 — activity-observed fallback for spots with unreadable posted hours.
describe("competitors/open-hours · observedWindow", () => {
  it("spans first to last active hour (half-open end)", () => {
    const scores = Array(24).fill(0)
    scores[10] = 30
    scores[15] = 80
    scores[21] = 12
    expect(observedWindow(scores)).toEqual({ start: 10, end: 22 })
  })

  it("bridges a mid-day lull into one conservative span (never two invented windows)", () => {
    const scores = Array(24).fill(0)
    scores[8] = 40
    scores[9] = 25
    // 10a-4p reads 0 (very quiet, still open) — the span must not split.
    scores[17] = 60
    scores[19] = 100
    expect(observedWindow(scores)).toEqual({ start: 8, end: 20 })
  })

  it("returns null for all-zero, missing, or empty curves", () => {
    expect(observedWindow(Array(24).fill(0))).toBeNull()
    expect(observedWindow(null)).toBeNull()
    expect(observedWindow(undefined)).toBeNull()
    expect(observedWindow([])).toBeNull()
  })

  it("labels the window as observed, plain language, hyphen range", () => {
    expect(observedLabel({ start: 10, end: 22 })).toBe("Observed 10 AM - 10 PM")
    // A full-day span must not read as "12 AM - 12 AM".
    expect(observedLabel({ start: 0, end: 24 })).toBe("Observed activity all day")
    expect(observedLabel({ start: 10, end: 22 })).not.toMatch(/–|—/)
  })
})

// Calendar-day overnight spill: "5 PM - 2 AM" belongs to BOTH days' tracks.
describe("competitors/open-hours · overnight spill (calendar days)", () => {
  it("attributes the after-midnight tail to the next day", () => {
    const byDay = parseWeekdayDescriptions([
      "Monday: 5:00 PM – 2:00 AM",
      "Tuesday: Closed",
    ])
    expect(byDay[1].intervals).toEqual([{ start: 17, end: 24 }])
    // Tuesday was Closed but gains the Monday-night tail: open 12 AM - 2 AM.
    expect(byDay[2]).toEqual({
      known: true,
      open: true,
      is24h: false,
      intervals: [{ start: 0, end: 2 }],
    })
    expect(openLabel(byDay[2])).toBe("12 AM - 2 AM")
  })

  it("merges the tail with the next day's own window (open, gap, open again)", () => {
    const byDay = parseWeekdayDescriptions([
      "Monday: 10:00 AM – 4:00 AM",
      "Tuesday: 10:00 AM – 4:00 AM",
    ])
    // Tuesday: Monday's 12a-4a tail + its own 10a-12a window.
    expect(byDay[2].intervals).toEqual([
      { start: 0, end: 4 },
      { start: 10, end: 24 },
    ])
    expect(openLabel(byDay[2])).toBe("12 AM - 4 AM, 10 AM - 12 AM")
  })

  it("wraps Saturday night into Sunday", () => {
    const byDay = parseWeekdayDescriptions(["Saturday: 8:00 PM – 3:00 AM"])
    expect(byDay[0]).toEqual({
      known: true,
      open: true,
      is24h: false,
      intervals: [{ start: 0, end: 3 }],
    })
  })

  it("does not spill a plain midnight close or a 24h day", () => {
    const a = parseWeekdayDescriptions(["Monday: 5:00 PM – 12:00 AM", "Tuesday: Closed"])
    expect(a[2]).toEqual({ known: true, open: false, is24h: false, intervals: [] })
    const b = parseWeekdayDescriptions(["Monday: Open 24 hours", "Tuesday: Open 24 hours"])
    expect(b[2].is24h).toBe(true)
  })
})
