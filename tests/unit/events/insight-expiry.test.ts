// Sunday 2026-08-23: Raising Cane's home page showed two plays about SATURDAY's concert.
//
// Reported by Bryan. One of the two was "Put one person on the door and shorten the order choices
// during Saturday's let-out rush", with a recipe window of 2026-08-22T22:00 to 2026-08-23T00:00,
// which had closed eight hours before the brief was even generated.
//
// The raw event was filtered correctly. The snapshot's Zach Bryan row (startDatetime
// 2026-08-22T19:00, endDatetime null) fails the dossier's demand-calendar gate on 08-23, as it
// should. It came in through the stored-insights door instead: build.ts keeps the freshest row of
// each type within RETENTION_DAYS (30), and the `events.major_lobby_surge` row for that concert was
// first written on 2026-08-13. It would have kept feeding briefs until roughly 2026-09-12.
//
// Every evidence shape below is copied from the real prod rows for location
// 4ded68b4-3cb1-49a5-b65a-93ce92484591, not invented.

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  eventInsightHasPassed,
  eventInsightLastDay,
  isEventInsightType,
} from "@/lib/events/insight-expiry"
import { REPO_ROOT } from "../support/source-literals"

/** The actual evidence blob from the row that caused this, trimmed to the dated fields. */
const ZACH_BRYAN = {
  role: "local_traffic",
  event: {
    uid: "a57ddce3de0d3907",
    title: "Zach Bryan - With Heaven On Tour",
    venue_name: "AT&T Stadium",
    startDatetime: "2026-08-22T19:00",
    displayedDates: null,
  },
  impact_score: 100,
  distance_miles: 0.6,
  attendance_estimate: 76500,
  capacity_confidence: "measured",
  authoritative_local_start: "2026-08-22T19:00",
}

describe("the report: Sunday showing Saturday's concert", () => {
  it("is expired on the Sunday", () => {
    expect(eventInsightHasPassed("events.major_lobby_surge", ZACH_BRYAN, "2026-08-23")).toBe(true)
  })

  it("was NOT expired on the Saturday itself", () => {
    // The event ran 7pm Saturday. On Saturday it is exactly the play an operator wants.
    expect(eventInsightHasPassed("events.major_lobby_surge", ZACH_BRYAN, "2026-08-22")).toBe(false)
  })

  it("was not expired in the run-up either", () => {
    for (const day of ["2026-08-13", "2026-08-20", "2026-08-21"]) {
      expect(eventInsightHasPassed("events.major_lobby_surge", ZACH_BRYAN, day), day).toBe(false)
    }
  })

  it("stays expired for the rest of the 30-day retention window", () => {
    // This is the actual damage: without the gate the row remains the freshest of its type and
    // keeps feeding briefs for weeks after the concert.
    for (const day of ["2026-08-24", "2026-09-01", "2026-09-12"]) {
      expect(eventInsightHasPassed("events.major_lobby_surge", ZACH_BRYAN, day), day).toBe(true)
    }
  })

  it("reads the date out of evidence, since date_key cannot answer this", () => {
    expect(eventInsightLastDay(ZACH_BRYAN)).toBe("2026-08-22")
  })
})

describe("every events.* shape that carries a date", () => {
  it("events.upcoming_dense_day, from evidence.date", () => {
    const ev = { date: "2026-08-22", count: 4 }
    expect(eventInsightHasPassed("events.upcoming_dense_day", ev, "2026-08-23")).toBe(true)
    expect(eventInsightHasPassed("events.upcoming_dense_day", ev, "2026-08-22")).toBe(false)
  })

  it("events.new_high_signal_event, from evidence.event.startDatetime", () => {
    // Real row: "The Bellamy Brothers at Arlington Music Hall (Fri, Aug 21)".
    const ev = { event: { title: "The Bellamy Brothers", startDatetime: "2026-08-21T20:00" } }
    expect(eventInsightHasPassed("events.new_high_signal_event", ev, "2026-08-23")).toBe(true)
  })

  it("a future one is untouched", () => {
    // Real row: "Guns N' Roses at Globe Life Field (Wed, Sep 9)".
    const ev = { event: { title: "Guns N' Roses", startDatetime: "2026-09-09T18:00" } }
    expect(eventInsightHasPassed("events.new_high_signal_event", ev, "2026-08-23")).toBe(false)
  })

  it("prefers an end date over a start date when both are present", () => {
    // A multi-day run that started yesterday and ends tomorrow is still live today.
    const ev = { event: { startDatetime: "2026-08-22T10:00", endDatetime: "2026-08-24T22:00" } }
    expect(eventInsightLastDay(ev)).toBe("2026-08-24")
    expect(eventInsightHasPassed("events.major_lobby_surge", ev, "2026-08-23")).toBe(false)
  })
})

describe("a multi-event row lives while ANY of its events is ahead", () => {
  // events.competitor_hosting_event lists several fixtures. Expiring it on the earliest would drop
  // a signal that is still true.
  const ev = {
    events: [
      { event_date: "2026-08-21" },
      { event_date: "2026-08-22" },
      { event_date: "2026-08-30" },
    ],
  }

  it("takes the latest date, not the earliest", () => {
    expect(eventInsightLastDay(ev)).toBe("2026-08-30")
  })

  it("is live while the last one is ahead", () => {
    expect(eventInsightHasPassed("events.competitor_hosting_event", ev, "2026-08-23")).toBe(false)
  })

  it("expires only after all of them have passed", () => {
    expect(eventInsightHasPassed("events.competitor_hosting_event", ev, "2026-08-30")).toBe(false)
    expect(eventInsightHasPassed("events.competitor_hosting_event", ev, "2026-08-31")).toBe(true)
  })
})

describe("scope: this rule touches events.* only", () => {
  it("never expires a non-event insight, whatever its evidence says", () => {
    // A review-theme or SEO row is a trend or a state, not a dated occurrence. Those depend on the
    // full 30-day retention window for provider-down resilience, and a stray date in their evidence
    // must not start expiring them.
    const withADate = { event: { startDatetime: "2020-01-01T00:00" }, date: "2020-01-01" }
    for (const type of [
      "review_themes",
      "seo_rank_change",
      "social.posting_gap",
      "traffic.surge",
      "menu.category_gap",
      "competitive_summary",
    ]) {
      expect(eventInsightHasPassed(type, withADate, "2026-08-23"), type).toBe(false)
    }
  })

  it("isEventInsightType is the whole scope test", () => {
    expect(isEventInsightType("events.major_lobby_surge")).toBe(true)
    expect(isEventInsightType("events.new_high_signal_event")).toBe(true)
    expect(isEventInsightType("review_themes")).toBe(false)
    // Not a prefix match on something else that merely contains the word.
    expect(isEventInsightType("visual.weather_patio")).toBe(false)
  })
})

describe("fails OPEN on a date it cannot read", () => {
  // Same polarity as the demand-calendar gate next door (`!when || when >= dateKey`), so the two
  // gates cannot disagree about the same event. Dropping real signal is the worse mistake.
  it("keeps a row with no date at all", () => {
    expect(eventInsightHasPassed("events.weekend_density_spike", {}, "2026-08-23")).toBe(false)
    expect(eventInsightHasPassed("events.competitor_event_cadence_up", { direction: "up" }, "2026-08-23")).toBe(false)
  })

  it("keeps a row whose date is null, empty or malformed", () => {
    for (const bad of [
      { event: { startDatetime: null } },
      { event: { startDatetime: "" } },
      { event: { startDatetime: "sometime next week" } },
      { date: "Sat, Aug 22" },
      { authoritative_local_start: 20260822 },
    ]) {
      expect(eventInsightHasPassed("events.major_lobby_surge", bad, "2026-08-23"), JSON.stringify(bad)).toBe(false)
      expect(eventInsightLastDay(bad)).toBeNull()
    }
  })

  it("keeps a row with no evidence object", () => {
    for (const bad of [null, undefined, "string", 42, []]) {
      expect(eventInsightHasPassed("events.major_lobby_surge", bad, "2026-08-23")).toBe(false)
    }
  })

  it("ignores an unreadable date but still uses a readable sibling", () => {
    // A partly-broken blob must not become a free pass when one field is perfectly good.
    const ev = { date: "not a date", authoritative_local_start: "2026-08-22T19:00" }
    expect(eventInsightLastDay(ev)).toBe("2026-08-22")
    expect(eventInsightHasPassed("events.major_lobby_surge", ev, "2026-08-23")).toBe(true)
  })
})

describe("the gate is actually wired into the dossier", () => {
  // The pure function above can be perfect and the bug still ship, because the defect was a MISSING
  // CALL rather than wrong logic. build.ts needs a database to run, so this asserts the wiring at
  // the source level, the same way tier-copy-is-derived.test.ts pins its iteration.
  it("build.ts calls eventInsightHasPassed while walking the stored insight rows", () => {
    const src = readFileSync(
      join(REPO_ROOT, "lib", "insights", "dossier", "build.ts"),
      "utf8",
    )
    expect(src, "import removed").toContain("@/lib/events/insight-expiry")
    expect(src, "gate call removed").toMatch(/eventInsightHasPassed\(\s*type\s*,\s*r\.evidence\s*,\s*dateKey\s*\)/)
    // And it must SKIP the row, not merely compute a boolean and drop it.
    expect(src).toMatch(/if \(eventInsightHasPassed\([^)]*\)\) continue/)
  })
})

describe("boundary: today is never expired", () => {
  it("an event today survives, at any hour", () => {
    // The gate is date-only, deliberately: the same comparison the demand calendar makes. An event
    // at 7pm is still ahead of an operator reading the brief that morning, and one at 9am is still
    // worth knowing about at 10.
    for (const t of ["T00:00", "T09:00", "T19:00", "T23:59"]) {
      const ev = { authoritative_local_start: `2026-08-23${t}` }
      expect(eventInsightHasPassed("events.major_lobby_surge", ev, "2026-08-23"), t).toBe(false)
    }
  })

  it("tolerates a todayKey that carries a time", () => {
    const ev = { authoritative_local_start: "2026-08-22T19:00" }
    expect(eventInsightHasPassed("events.major_lobby_surge", ev, "2026-08-23T08:28:58Z")).toBe(true)
  })

  it("yesterday is expired even by one day", () => {
    const ev = { authoritative_local_start: "2026-08-22T23:59" }
    expect(eventInsightHasPassed("events.major_lobby_surge", ev, "2026-08-23")).toBe(true)
  })
})
