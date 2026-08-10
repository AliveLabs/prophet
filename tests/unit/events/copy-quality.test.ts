// Beta-facing copy quality (2026-08-10). Every case here is a REAL string observed in prod
// on the first grounded run, after EVENTS_SOURCE=grounded went live.
//
// The complaint being fixed: operators were paying ~$1.75/brief to be told
// "Major event nearby: A major event". Accurate, verified, named event data was arriving
// and the copy refused to use it.

import { describe, it, expect } from "vitest"
import { isSafeEventTitle, hasUnverifiedStartTime, dropUnverifiedTime } from "@/lib/events/title-safety"
import { eventNameOrNull, beatsSurge } from "@/lib/events/insights"
import { classifyEventMagnitude, isNonDrawListing } from "@/lib/events/relevance"
import type { NormalizedEvent } from "@/lib/events/types"
import type { ImpactResult } from "@/lib/events/impact"

const ev = (over: Partial<NormalizedEvent>): NormalizedEvent =>
  ({ uid: "u", source: "dataforseo_google_events", ...over }) as unknown as NormalizedEvent

describe("isSafeEventTitle — placeholders must never reach an operator", () => {
  it("rejects the real prod placeholder", () => {
    expect(isSafeEventTitle("Dallas Wings vs. [Opponent Not Specified]")).toBe(false)
  })

  it("rejects the hedge vocabulary a generative source reaches for", () => {
    for (const t of [
      "Concert TBA",
      "Rangers vs TBD",
      "Event to be announced",
      "Unknown Artist Live",
      "Match vs.",
      "{team} at Globe Life Field",
      "N/A",
      "",
      "  ",
    ]) {
      expect(isSafeEventTitle(t), `should reject: ${JSON.stringify(t)}`).toBe(false)
    }
  })

  it("accepts real named events", () => {
    for (const t of [
      "BTS WORLD TOUR 'ARIRANG'",
      "Washington Nationals at Texas Rangers",
      "Zach Bryan - With Heaven On Tour",
      "Ricky Skaggs & Kentucky Thunder",
    ]) {
      expect(isSafeEventTitle(t), `should accept: ${t}`).toBe(true)
    }
  })
})

describe("unverified midnight starts", () => {
  it("treats T00:00 as 'time unknown', not as midnight", () => {
    expect(hasUnverifiedStartTime("2026-08-16T00:00")).toBe(true)
    expect(hasUnverifiedStartTime("2026-08-16T00:00:00")).toBe(true)
    expect(hasUnverifiedStartTime(null)).toBe(true)
  })

  it("leaves a real time alone", () => {
    expect(hasUnverifiedStartTime("2026-08-15T20:00")).toBe(false)
    expect(hasUnverifiedStartTime("2026-08-18T19:05")).toBe(false)
  })

  it("drops an unverified time down to the date rather than asserting 12:00 AM", () => {
    expect(dropUnverifiedTime("2026-08-16T00:00")).toBe("2026-08-16")
    expect(dropUnverifiedTime("2026-08-15T20:00")).toBe("2026-08-15T20:00")
    expect(dropUnverifiedTime(null)).toBeNull()
  })
})

describe("eventNameOrNull — naming, with the gates that replace P13 suppression", () => {
  const bts = ev({
    title: "BTS WORLD TOUR 'ARIRANG'",
    venue: { name: "AT&T Stadium" },
    venueConfidence: "matched_place_id",
  })

  it("NAMES a verified event (the headline fix)", () => {
    expect(eventNameOrNull(bts)).toBe("BTS WORLD TOUR 'ARIRANG'")
  })

  it("refuses to name an event we could not place", () => {
    expect(eventNameOrNull(ev({ ...bts, venueConfidence: "unresolved" }))).toBeNull()
    expect(eventNameOrNull(ev({ ...bts, venueConfidence: undefined }))).toBeNull()
  })

  it("refuses to name a placeholder title even at a resolved venue", () => {
    const placeholder = ev({
      title: "Dallas Wings vs. [Opponent Not Specified]",
      venueConfidence: "matched_place_id",
    })
    expect(eventNameOrNull(placeholder)).toBeNull()
  })

  it("LEAGUE VETO: an unvalidated league listing stays generic (the World Cup fix)", () => {
    const unvalidated = ev({
      title: "FIFA World Cup Match 78",
      venueConfidence: "matched_place_id",
      leagueValidated: false,
    })
    expect(eventNameOrNull(unvalidated)).toBeNull()
  })

  it("uses the authoritative competition name when the cross-check PASSED", () => {
    const validated = ev({
      title: "some scraped string",
      venueConfidence: "matched_place_id",
      leagueValidated: true,
      fixtureRef: "fifa-world-cup-2026:att-stadium:2026-06-17",
    })
    expect(eventNameOrNull(validated)).toBe("A FIFA World Cup match")
  })

  it("names a non-league concert at a resolved venue without needing a fixture", () => {
    expect(eventNameOrNull(ev({
      title: "Zach Bryan - With Heaven On Tour",
      venueConfidence: "geocoded_only",
    }))).toBe("Zach Bryan - With Heaven On Tour")
  })
})

describe("isNonDrawListing — a big venue NAME is not a big EVENT", () => {
  it("rejects the real prod facility listings", () => {
    expect(isNonDrawListing(ev({ title: "Stadium Tour", venue: { name: "AT&T Stadium Tours" } }))).toBe(true)
    expect(isNonDrawListing(ev({ title: "Watch the match", venue: { name: "FIFA World Cup Fan Viewing Zone" } }))).toBe(true)
  })

  it("does NOT catch a real stadium concert whose title contains 'Tour'", () => {
    expect(isNonDrawListing(ev({ title: "BTS WORLD TOUR 'ARIRANG'", venue: { name: "AT&T Stadium" } }))).toBe(false)
    expect(isNonDrawListing(ev({ title: "Zach Bryan - With Heaven On Tour", venue: { name: "AT&T Stadium" } }))).toBe(false)
  })

  it("caps a facility listing to minor even with a stadium venue and tickets", () => {
    const tours = ev({
      title: "AT&T Stadium Self-Guided Tour",
      venue: { name: "AT&T Stadium Tours" },
      ticketsAndInfo: [{ url: "a" }, { url: "b" }],
    } as Partial<NormalizedEvent>)
    expect(classifyEventMagnitude(tours)).toBe("minor")
  })

  it("still scores the real concert at the same stadium as major", () => {
    const concert = ev({
      title: "BTS WORLD TOUR 'ARIRANG'",
      venue: { name: "AT&T Stadium" },
      ticketsAndInfo: [{ url: "a" }, { url: "b" }],
    } as Partial<NormalizedEvent>)
    expect(classifyEventMagnitude(concert)).toBe("major")
  })
})

describe("beatsSurge — the biggest event wins, not the first one listed", () => {
  const res = (score: number, incremental: number): ImpactResult =>
    ({ score, absoluteIncremental: incremental }) as unknown as ImpactResult

  it("prefers a higher score", () => {
    expect(beatsSurge(res(90, 100), ev({}), res(50, 100), ev({}))).toBe(true)
    expect(beatsSurge(res(50, 100), ev({}), res(90, 100), ev({}))).toBe(false)
  })

  it("THE PROD BUG: with both scores saturated at 100, the bigger draw wins", () => {
    // A sold-out 80k concert 0.6mi out lost the surge slot to a ballgame 1mi out purely
    // because it appeared later in the array. Score caps at 100, so they tied.
    const bts = ev({ distanceMiles: 0.6 })
    const rangers = ev({ distanceMiles: 1.0 })
    expect(beatsSurge(res(100, 4200), bts, res(100, 942), rangers)).toBe(true)
    expect(beatsSurge(res(100, 942), rangers, res(100, 4200), bts)).toBe(false)
  })

  it("falls back to proximity when score AND incremental both tie", () => {
    const near = ev({ distanceMiles: 0.4 })
    const far = ev({ distanceMiles: 3.0 })
    expect(beatsSurge(res(100, 500), near, res(100, 500), far)).toBe(true)
    expect(beatsSurge(res(100, 500), far, res(100, 500), near)).toBe(false)
  })

  it("an unmeasured distance never beats a measured one on the tie-break", () => {
    expect(beatsSurge(res(100, 500), ev({}), res(100, 500), ev({ distanceMiles: 2 }))).toBe(false)
  })
})
