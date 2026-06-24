import { describe, it, expect } from "vitest"
import {
  validateEvent,
  validateEvents,
  isScheduledLeagueTitle,
  localDateOf,
  normalizeTitle,
  isValidatedLocalDemand,
} from "@/lib/events/validate"
import { seedFixtureIndex } from "@/lib/events/fixtures/loader"
import type { CatalogVenue } from "@/lib/events/venue-catalog"
import type { NormalizedEvent } from "@/lib/events/types"

// ── Deterministic fixtures (no network, no model) ──────────────────────────

const fx = seedFixtureIndex()

// AT&T Stadium (Dallas) is in the WC2026 seed: England vs Croatia on 2026-06-17 15:00.
const ATT: CatalogVenue = {
  placeId: "place_att",
  name: "AT&T Stadium",
  primaryType: "stadium",
  lat: 32.7473,
  lng: -97.0945,
  distanceMi: 0.2,
  capacityLow: 80000,
  capacityHigh: 80000,
  capacityConfidence: "measured",
  aliases: ["Dallas Stadium"],
}

const catalog: CatalogVenue[] = [ATT]

function ev(over: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    uid: "uid-" + Math.random().toString(36).slice(2),
    source: "dataforseo_google_events",
    keyword: "world cup",
    dateRange: "week",
    ...over,
  }
}

// An event that geocoded ONTO the catalog stadium (annotate.ts already stamped catalogVenueName).
function leagueEventAt(date: string, over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return ev({
    title: "FIFA World Cup: England vs Croatia",
    venue: { name: "Dallas Stadium", lat: 32.7473, lng: -97.0945 },
    catalogVenueName: "AT&T Stadium",
    startDatetime: `${date}T15:00:00`,
    distanceMiles: 0.2,
    role: "local_foot",
    magnitude: "major",
    capacityLow: 80000,
    capacityHigh: 80000,
    capacityConfidence: "measured",
    ...over,
  })
}

describe("helpers", () => {
  it("isScheduledLeagueTitle catches FIFA/world cup/NFL etc.", () => {
    expect(isScheduledLeagueTitle("FIFA World Cup: England vs Croatia")).toBe(true)
    expect(isScheduledLeagueTitle("Cowboys vs Eagles (NFL)")).toBe(true)
    expect(isScheduledLeagueTitle("Latin Music Night")).toBe(false)
  })
  it("localDateOf reads the LOCAL date portion (no UTC roll)", () => {
    expect(localDateOf("2026-06-17T20:00:00")).toBe("2026-06-17")
    expect(localDateOf(null)).toBeNull()
  })
  it("normalizeTitle is punctuation-light + whitespace-collapsed", () => {
    expect(normalizeTitle("  England vs.  Croatia! ")).toBe("england vs croatia")
  })
})

describe("R1 — WC2026 cross-check: venue + date must match", () => {
  it("VALIDATES a match at the right venue on the right date → carries authoritative fields", () => {
    const v = validateEvent(leagueEventAt("2026-06-17"), catalog, fx)
    expect(v.leagueValidated).toBe(true)
    expect(v.venueConfidence).toBe("matched_place_id")
    expect(v.fields.canonicalVenue).toBe("AT&T Stadium")
    expect(v.fields.authoritativeLocalStart).toBe("2026-06-17 15:00")
    expect(v.fields.fixtureRef).toBe("fifa-world-cup-2026:att-stadium:2026-06-17")
    // A validated league venue keeps its local role (drives demand).
    expect(isValidatedLocalDemand(v)).toBe(true)
  })

  it("DROPS-to-metro_hook on a DATE mismatch (right venue, wrong date)", () => {
    // No WC2026 match at AT&T Stadium on 2026-06-18 → the listing can't be trusted as nearby.
    const v = validateEvent(leagueEventAt("2026-06-18"), catalog, fx)
    expect(v.leagueValidated).toBe(false)
    expect(v.downgradeReason).toBe("league_date_mismatch")
    expect(v.role).toBe("metro_hook")
    expect(isValidatedLocalDemand(v)).toBe(false)
  })

  it("DOWNGRADES on a VENUE mismatch (league title, venue not a host venue)", () => {
    // Geocoded to a real point but NOT a fixture venue, while claiming a league.
    const wrongVenue = ev({
      title: "FIFA World Cup: England vs Croatia",
      venue: { name: "Joe's Sports Bar", lat: 32.9, lng: -97.3 },
      startDatetime: "2026-06-17T15:00:00",
      distanceMiles: 1.0,
      role: "local_traffic",
      magnitude: "moderate",
    })
    const v = validateEvent(wrongVenue, catalog, fx)
    expect(v.leagueValidated).toBe(false)
    expect(v.downgradeReason).toBe("league_venue_mismatch")
    expect(v.role).toBe("metro_hook")
    expect(isValidatedLocalDemand(v)).toBe(false)
  })

  it("resolves a listing under the FIFA ALIAS too (Dallas Stadium → AT&T Stadium)", () => {
    // No catalog match stamped, but the venue name is the FIFA alias → fixture name lookup resolves.
    const aliasOnly = ev({
      title: "FIFA World Cup Match",
      venue: { name: "Dallas Stadium", lat: 32.7473, lng: -97.0945 },
      catalogVenueName: "AT&T Stadium",
      startDatetime: "2026-06-22T12:00:00", // Argentina vs Austria at AT&T
      distanceMiles: 0.2,
      role: "local_foot",
    })
    const v = validateEvent(aliasOnly, catalog, fx)
    expect(v.leagueValidated).toBe(true)
    expect(v.fields.canonicalVenue).toBe("AT&T Stadium")
    expect(v.fields.authoritativeLocalStart).toBe("2026-06-22 12:00")
  })
})

describe("R1 — unresolved venue may NEVER claim local impact", () => {
  it("an ungeocoded event is capped at metro_hook (never local)", () => {
    const unresolved = ev({
      title: "Some Concert",
      venue: { name: "Unknown Hall" }, // no lat/lng
      startDatetime: "2026-07-01T20:00:00",
      distanceMiles: null,
      role: "local_foot", // even if upstream wrongly tagged it local
    })
    const v = validateEvent(unresolved, catalog, fx)
    expect(v.venueConfidence).toBe("unresolved")
    expect(v.role).toBe("metro_hook")
    expect(v.downgradeReason).toBe("unresolved_venue")
    expect(isValidatedLocalDemand(v)).toBe(false)
  })

  it("a geocoded-only (non-catalog, non-league) event keeps its local role", () => {
    const indie = ev({
      title: "Neighborhood Food Truck Festival",
      venue: { name: "5th Street Lot", lat: 32.78, lng: -96.8 },
      startDatetime: "2026-07-02T17:00:00",
      distanceMiles: 0.4,
      role: "local_foot",
    })
    const v = validateEvent(indie, catalog, fx)
    expect(v.venueConfidence).toBe("geocoded_only")
    expect(v.role).toBe("local_foot")
    expect(isValidatedLocalDemand(v)).toBe(true)
    // authoritative start falls back to the event's own start for a resolved non-league event.
    expect(v.fields.authoritativeLocalStart).toBe("2026-07-02T17:00:00")
  })
})

describe("R1 — dedupe by (venueId, localDate, normalizedTitle)", () => {
  it("collapses duplicate listings, keeping the STRONGER signal", () => {
    const strong = leagueEventAt("2026-06-17") // league-validated, matched_place_id
    // A duplicate of the SAME match (same venue/date/title) but weaker (no catalog match, league
    // title still resolves by alias → also validates, but use a geocoded-only dup to prove ranking).
    const weakDup = ev({
      title: "FIFA World Cup: England vs Croatia",
      venue: { name: "AT&T Stadium", lat: 32.7473, lng: -97.0945 },
      catalogVenueName: "AT&T Stadium",
      startDatetime: "2026-06-17T15:00:00",
      distanceMiles: 0.2,
      role: "local_foot",
    })
    const out = validateEvents([strong, weakDup], catalog, fx)
    expect(out.length).toBe(1) // deduped
    expect(out[0].leagueValidated).toBe(true)
  })

  it("does NOT collapse distinct matches (different date) at the same venue", () => {
    const m1 = leagueEventAt("2026-06-17", { uid: "m1", title: "FIFA World Cup: England vs Croatia" })
    const m2 = leagueEventAt("2026-06-22", { uid: "m2", title: "FIFA World Cup: Argentina vs Austria" })
    const out = validateEvents([m1, m2], catalog, fx)
    expect(out.length).toBe(2)
  })
})
