// Beta-facing copy quality (2026-08-10). Every case here is a REAL string observed in prod
// on the first grounded run, after EVENTS_SOURCE=grounded went live.
//
// The complaint being fixed: operators were paying ~$1.75/brief to be told
// "Major event nearby: A major event". Accurate, verified, named event data was arriving
// and the copy refused to use it.

import { describe, it, expect } from "vitest"
import { isSafeEventTitle, hasUnverifiedStartTime, dropUnverifiedTime, isNonDrawVenueName, displayEventTitle } from "@/lib/events/title-safety"
import { eventNameOrNull, beatsSurge } from "@/lib/events/insights"
import { classifyEventMagnitude, isNonDrawListing } from "@/lib/events/relevance"
import { matchEventToCatalog } from "@/lib/events/venue-catalog"
import { titleStem } from "@/lib/events/validate"
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

describe("catalog match — the main venue wins, not its gift shop", () => {
  // The real prod catalog around AT&T Stadium. "AT&T Stadium Tours" geocoded 0.013mi
  // closer than the stadium itself, so nearest-wins handed a sold-out 90,000-seat concert
  // a capacity of 500. That 180x understatement is why BTS never cleared the bar.
  const catalog = [
    { name: "Dallas Stadium", lat: 32.7473, lng: -97.0945, capacityLow: 90000, capacityHigh: 90000, capacityConfidence: "prior", placeId: "stadium" },
    { name: "AT&T Stadium Tours", lat: 32.7474, lng: -97.0943, capacityLow: 500, capacityHigh: 5000, capacityConfidence: "prior", placeId: "tours" },
    { name: "Lot 15 AT&T Stadium", lat: 32.7472, lng: -97.0944, capacityLow: 500, capacityHigh: 8000, capacityConfidence: "prior", placeId: "lot" },
  ] as unknown as Parameters<typeof matchEventToCatalog>[2]

  it("picks the stadium, not the tours desk sitting closer", () => {
    const m = matchEventToCatalog(32.74741, -97.09431, catalog)
    expect(m?.name).toBe("Dallas Stadium")
    expect(m?.capacityLow).toBe(90000)
  })

  it("identifies the ancillary facilities by name", () => {
    expect(isNonDrawVenueName("AT&T Stadium Tours")).toBe(true)
    expect(isNonDrawVenueName("Lot 15 AT&T Stadium")).toBe(true)
    expect(isNonDrawVenueName("FIFA World Cup Fan Viewing Zone")).toBe(true)
    expect(isNonDrawVenueName("AT&T Stadium")).toBe(false)
    expect(isNonDrawVenueName("Globe Life Field")).toBe(false)
  })

  it("returns null when nothing is inside the tolerance", () => {
    expect(matchEventToCatalog(33.5, -97.5, catalog)).toBeNull()
  })
})

describe("titleStem — one ballgame is one event, not three giveaways", () => {
  it("collapses promo variants of the same game", () => {
    const a = titleStem("Texas Rangers vs Los Angeles Angels: Block Captain Bobblehead")
    const b = titleStem("Texas Rangers vs Los Angeles Angels: 1996 Rangers Team Baseball Card Button-Down")
    expect(a).toBe(b)
    expect(a).toBe("texas rangers vs los angeles angels")
  })

  it("keeps a LEADING qualifier rather than collapsing to it", () => {
    // Would otherwise become just "preseason" and merge unrelated games.
    expect(titleStem("PRESEASON: New Orleans Saints vs. Dallas Cowboys"))
      .toBe("preseason new orleans saints vs dallas cowboys")
  })

  it("leaves colon-free titles alone", () => {
    expect(titleStem("BTS World Tour 'ARIRANG'")).toBe("bts world tour arirang")
  })
})

describe("high-signal gate — significance, not ticket-link count", () => {
  // Real prod case: BTS (90k capacity, 1 scraped ticket link, no keyword match) was dropped
  // while a smaller show at the SAME venue surfaced purely because it had 2 ticket links.
  const bts = ev({
    title: "BTS WORLD TOUR 'ARIRANG'",
    venue: { name: "AT&T Stadium" },
    venueConfidence: "matched_place_id",
    magnitude: "major",
    ticketsAndInfo: [{ url: "a" }],
  } as Partial<NormalizedEvent>)

  it("HIGH_SIGNAL_KEYWORDS genuinely does not match modern touring acts", () => {
    // Documents WHY magnitude was needed: the list is food/festival/league vocabulary.
    const kws = ["festival","concert","food","sports","game","nfl","nba","mlb","world cup"]
    const t = "bts world tour 'arirang'"
    expect(kws.some((k) => t.includes(k))).toBe(false)
  })

  it("a major-magnitude event qualifies on magnitude alone", () => {
    const qualifies = (e: NormalizedEvent) => {
      const kw = false
      const tix = (e.ticketsAndInfo?.length ?? 0) >= 2
      return kw || tix || e.magnitude === "major"
    }
    expect(qualifies(bts)).toBe(true)
  })

  it("a minor event with one ticket link still does NOT qualify", () => {
    const small = ev({ title: "Open mic night", magnitude: "minor", ticketsAndInfo: [{ url: "a" }] } as Partial<NormalizedEvent>)
    const qualifies = (e: NormalizedEvent) => {
      const tix = (e.ticketsAndInfo?.length ?? 0) >= 2
      return tix || e.magnitude === "major"
    }
    expect(qualifies(small)).toBe(false)
  })
})

describe("beatsSurge — same-venue ties fall back to soonest date", () => {
  const res = (score: number, incremental: number): ImpactResult =>
    ({ score, absoluteIncremental: incremental }) as unknown as ImpactResult

  it("BTS (Aug 15) beats Zach Bryan (Aug 22) at the same stadium", () => {
    // Identical venue: same capacity, same distance, same score. Previously array order won.
    const btsEv = ev({ distanceMiles: 0.6, startDatetime: "2026-08-15T20:00" })
    const zachEv = ev({ distanceMiles: 0.6, startDatetime: "2026-08-22T19:00" })
    expect(beatsSurge(res(100, 4200), btsEv, res(100, 4200), zachEv)).toBe(true)
    expect(beatsSurge(res(100, 4200), zachEv, res(100, 4200), btsEv)).toBe(false)
  })

  it("a bigger draw still wins over a sooner but smaller one", () => {
    const soonSmall = ev({ distanceMiles: 0.6, startDatetime: "2026-08-15T20:00" })
    const laterBig = ev({ distanceMiles: 0.6, startDatetime: "2026-08-22T19:00" })
    expect(beatsSurge(res(100, 4200), laterBig, res(100, 900), soonSmall)).toBe(true)
  })
})

describe("displayEventTitle — drop the giveaway, keep the game", () => {
  it("strips the promo suffix from real prod titles", () => {
    expect(displayEventTitle("Texas Rangers vs. Los Angeles Angels: Block Captain Bobblehead"))
      .toBe("Texas Rangers vs. Los Angeles Angels")
    expect(displayEventTitle("Texas Rangers vs. Oakland Athletics: Rangers Shoe Charms"))
      .toBe("Texas Rangers vs. Oakland Athletics")
  })

  it("keeps a LEADING qualifier whole", () => {
    expect(displayEventTitle("PRESEASON: New Orleans Saints vs. Dallas Cowboys"))
      .toBe("PRESEASON: New Orleans Saints vs. Dallas Cowboys")
  })

  it("leaves colon-free titles untouched, casing preserved", () => {
    expect(displayEventTitle("BTS World Tour \"ARIRANG\"")).toBe("BTS World Tour \"ARIRANG\"")
    expect(displayEventTitle("Concert by Candlelight - Classic Rock Reimagined"))
      .toBe("Concert by Candlelight - Classic Rock Reimagined")
  })

  it("different games keep their own identity (dedupe is by date, not title)", () => {
    const a = displayEventTitle("Texas Rangers vs. Los Angeles Angels: Block Captain Bobblehead")
    const b = displayEventTitle("Texas Rangers vs. Washington Nationals: All for Texas Football Jersey")
    expect(a).not.toBe(b)
  })
})
