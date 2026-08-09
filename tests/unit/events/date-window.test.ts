// Regression: the events page must filter on the event's REAL local date, never on
// `NormalizedEvent.dateRange` (which is the QUERY's horizon, not the event's date).
//
// THE BUG: marquee-venue probes are issued on the "month" horizon (keywords.ts), and
// normalize.ts stamps each event with the horizon of the query that found it. The page
// then kept only `dateRange === "week"`, so 100% of stadium-probe results were discarded
// before render. A sold-out 80,000-seat BTS show at AT&T Stadium on Sat 2026-08-15
// surfaced to the operator as "0 events". Nothing ever wrote "weekend" (so that tab was
// permanently empty) and nothing ever wrote "all" (so both escape hatches were dead).
//
// Calendar anchors (verified): 2026-08-08 Sat · 08-09 Sun · 08-14 Fri · 08-15 Sat · 08-16 Sun.

import { describe, it, expect } from "vitest"
import {
  isInDateWindow,
  addDaysToDateKey,
  WEEK_WINDOW_DAYS,
  WINDOW_LOOKBACK_DAYS,
} from "@/app/(dashboard)/events/events-map"
import { isWeekendEvent } from "@/lib/events/insights"
import type { NormalizedEvent } from "@/lib/events/types"

const TODAY = "2026-08-09" // Sunday

const ev = (over: Partial<NormalizedEvent>): NormalizedEvent =>
  ({ uid: "u", source: "dataforseo_google_events", ...over }) as unknown as NormalizedEvent

/** The real thing, as the venue probe returns it: found by the "AT&T Stadium" probe,
 *  which runs on the "month" horizon. */
const BTS = ev({
  title: "BTS WORLD TOUR 'ARIRANG' IN ARLINGTON",
  startDatetime: "2026-08-15T20:00:00Z",
  venue: { name: "AT&T Stadium" },
  dateRange: "month",
  role: "local_traffic",
})

describe("addDaysToDateKey", () => {
  it("shifts forward and backward", () => {
    expect(addDaysToDateKey("2026-08-09", 7)).toBe("2026-08-16")
    expect(addDaysToDateKey("2026-08-09", -1)).toBe("2026-08-08")
  })

  it("crosses month and year boundaries", () => {
    expect(addDaysToDateKey("2026-08-31", 1)).toBe("2026-09-01")
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDaysToDateKey("2026-01-01", -1)).toBe("2025-12-31")
  })

  it("survives a DST boundary without rolling the day (anchored at UTC noon)", () => {
    // US DST ends 2026-11-01. A naive local-midnight anchor can land on 10-31.
    expect(addDaysToDateKey("2026-10-31", 1)).toBe("2026-11-01")
    expect(addDaysToDateKey("2026-11-01", 1)).toBe("2026-11-02")
  })
})

describe("isInDateWindow — the headline bug", () => {
  it("KEEPS a dateRange:'month' event dated inside the window (BTS @ AT&T Stadium)", () => {
    // This is the exact assertion that was false before the fix.
    expect(isInDateWindow(BTS, TODAY)).toBe(true)
  })

  it("keeps the second night too (2026-08-16, the window's last day)", () => {
    expect(isInDateWindow(ev({ ...BTS, startDatetime: "2026-08-16T20:00:00Z" }), TODAY)).toBe(true)
  })

  it("drops an event past the window", () => {
    expect(isInDateWindow(ev({ startDatetime: "2026-08-17T20:00:00Z" }), TODAY)).toBe(false)
  })

  it("drops an event well before the window", () => {
    expect(isInDateWindow(ev({ startDatetime: "2026-08-01T20:00:00Z" }), TODAY)).toBe(false)
  })

  it("keeps TONIGHT's event when the server's UTC date has already rolled over", () => {
    // A US-Central 8pm show on 08-08 serializes past midnight UTC; without the lookback
    // it would vanish hours before it starts.
    expect(isInDateWindow(ev({ startDatetime: "2026-08-08T20:00:00Z" }), TODAY)).toBe(true)
    expect(WINDOW_LOOKBACK_DAYS).toBeGreaterThanOrEqual(1)
  })

  it("keeps undated events rather than silently losing them to a scrape gap", () => {
    expect(isInDateWindow(ev({ startDatetime: null, displayedDates: "Aug 15" }), TODAY)).toBe(true)
  })

  it("prefers the AUTHORITATIVE local start over the scraped one", () => {
    const e = ev({ authoritativeLocalStart: "2026-08-15 20:00", startDatetime: "2026-09-30T20:00:00Z" })
    expect(isInDateWindow(e, TODAY)).toBe(true)
  })

  it("is horizon-agnostic: identical verdict for every dateRange stamp", () => {
    for (const dateRange of ["week", "weekend", "month", "all", undefined]) {
      expect(isInDateWindow(ev({ ...BTS, dateRange } as Partial<NormalizedEvent>), TODAY)).toBe(true)
    }
  })

  it("uses a 7-day forward window", () => {
    expect(WEEK_WINDOW_DAYS).toBe(7)
  })
})

describe("EVENTS_SOURCE guard — a grounded/hybrid snapshot must still render", () => {
  it("renders grounded events, which normalize-grounded stamps 'month' wholesale", () => {
    // Flipping EVENTS_SOURCE to grounded|hybrid used to blank the events page for EVERY
    // location, because normalize-grounded stamps every event with the "month" horizon.
    const grounded = [
      ev({ startDatetime: "2026-08-15T20:00:00Z", dateRange: "month", source: "dataforseo_google_events" }),
      ev({ startDatetime: "2026-08-12T19:00:00Z", dateRange: "month", source: "dataforseo_google_events" }),
    ]
    const rendered = grounded.filter((e) => isInDateWindow(e, TODAY))
    expect(rendered).toHaveLength(2)
  })
})

describe("weekend tab — real day-of-week, not the dead 'weekend' stamp", () => {
  it("keeps a Saturday show that carries the 'month' stamp", () => {
    expect(isWeekendEvent(BTS)).toBe(true)
  })

  it("excludes a midweek show", () => {
    expect(isWeekendEvent(ev({ startDatetime: "2026-08-12T19:00:00Z" }))).toBe(false)
  })

  it("the full weekend-tab predicate keeps BTS and drops the Wednesday show", () => {
    const weekendTab = (e: NormalizedEvent) => isInDateWindow(e, TODAY) && isWeekendEvent(e)
    expect(weekendTab(BTS)).toBe(true)
    expect(weekendTab(ev({ startDatetime: "2026-08-12T19:00:00Z" }))).toBe(false)
  })
})
