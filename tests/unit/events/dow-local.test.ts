// Regression: events day-of-week must be the VENUE-LOCAL day, not the UTC instant's day, so the
// impact engine looks up the correct baseline foot-traffic curve and weekend classification.
// (Code review 2026-06-26: dowOf used getUTCDay() on the UTC startDatetime.)
//
// Calendar anchors (verified): 2026-01-02 Fri · 01-03 Sat · 01-04 Sun · 01-05 Mon.

import { describe, it, expect } from "vitest"
import { dowOf, isWeekendEvent } from "@/lib/events/insights"
import type { NormalizedEvent } from "@/lib/events/types"

const ev = (over: Partial<NormalizedEvent>): NormalizedEvent => ({ ...over } as unknown as NormalizedEvent)

describe("dowOf — venue-local day-of-week", () => {
  it("uses the AUTHORITATIVE local date, not the UTC instant (the headline bug)", () => {
    // 11pm local Sunday Jan 4 → 04:00 UTC Monday Jan 5. Local day is Sunday (0), NOT Monday (1).
    const e = ev({ authoritativeLocalStart: "2026-01-04 23:00", startDatetime: "2026-01-05T04:00:00Z" })
    expect(dowOf(e)).toBe(0) // Sunday — the venue-local day
    expect(dowOf(e)).not.toBe(1) // would be Monday under the old getUTCDay() bug
  })

  it("prefers authoritativeLocalStart over startDatetime when both are present", () => {
    const e = ev({ authoritativeLocalStart: "2026-01-02 22:00", startDatetime: "2026-01-03T03:00:00Z" })
    expect(dowOf(e)).toBe(5) // Friday (local), not Saturday (6) from the UTC date
  })

  it("falls back to the startDatetime date component when no authoritative local start", () => {
    const e = ev({ startDatetime: "2026-01-05T04:00:00Z" })
    expect(dowOf(e)).toBe(1) // Monday Jan 5
  })

  it("returns null when there is no parseable date", () => {
    expect(dowOf(ev({}))).toBeNull()
    expect(dowOf(ev({ startDatetime: "next Saturday" }))).toBeNull()
  })
})

describe("isWeekendEvent — venue-local classification", () => {
  it("a Sunday-local event that rolls to Monday in UTC is still a weekend", () => {
    const e = ev({ authoritativeLocalStart: "2026-01-04 23:00", startDatetime: "2026-01-05T04:00:00Z" })
    expect(isWeekendEvent(e)).toBe(true) // local Sunday; old code saw UTC Monday → false
  })

  it("a Friday-local event that rolls to Saturday in UTC is NOT a weekend", () => {
    const e = ev({ authoritativeLocalStart: "2026-01-02 23:00", startDatetime: "2026-01-03T04:00:00Z" })
    expect(isWeekendEvent(e)).toBe(false) // local Friday; old code saw UTC Saturday → true
  })

  it("falls back to coarse textual hints when there is no timestamp", () => {
    expect(isWeekendEvent(ev({ dateRange: "weekend" }))).toBe(true)
    expect(isWeekendEvent(ev({ displayedDates: "Sat, Jan 3" }))).toBe(true)
    expect(isWeekendEvent(ev({ displayedDates: "Wed, Jan 7" }))).toBe(false)
    expect(isWeekendEvent(ev({}))).toBe(false)
  })
})
