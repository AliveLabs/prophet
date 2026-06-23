import { describe, it, expect } from "vitest"
import {
  aliasesFor,
  matchEventToCatalog,
  isMajorCapacity,
  normalizeVenueName,
  type CatalogVenue,
} from "@/lib/events/venue-catalog"

const stadium: CatalogVenue = {
  placeId: "x",
  name: "AT&T Stadium",
  primaryType: "stadium",
  lat: 32.7473,
  lng: -97.0945,
  distanceMi: 0.1,
  capacityLow: 80000,
  capacityHigh: 80000,
  capacityConfidence: "measured",
  aliases: ["Dallas Stadium"],
}

describe("aliasesFor (FIFA rebrands)", () => {
  it("maps AT&T Stadium → Dallas Stadium (case-insensitive)", () => {
    expect(aliasesFor("AT&T Stadium")).toContain("Dallas Stadium")
    expect(aliasesFor("at&t stadium")).toContain("Dallas Stadium")
  })
  it("unknown venue → no aliases", () => {
    expect(aliasesFor("Joe's Diner")).toEqual([])
  })
})

describe("normalizeVenueName", () => {
  it("lowercases + collapses whitespace", () => {
    expect(normalizeVenueName("  AT&T   Stadium ")).toBe("at&t stadium")
  })
})

describe("matchEventToCatalog (coordinate match, rebrand-proof)", () => {
  it("matches an event geocoded onto the stadium even under a different name", () => {
    // The event title says "Dallas Stadium" but it geocodes to AT&T Stadium's coords.
    const m = matchEventToCatalog(32.7474, -97.0946, [stadium])
    expect(m?.name).toBe("AT&T Stadium")
    expect(m?.capacityHigh).toBe(80000)
  })
  it("does not match a far point", () => {
    expect(matchEventToCatalog(32.8, -97.2, [stadium])).toBeNull()
  })
  it("null coords → no match", () => {
    expect(matchEventToCatalog(null, null, [stadium])).toBeNull()
  })
})

describe("isMajorCapacity", () => {
  it("threshold at 5000", () => {
    expect(isMajorCapacity(80000)).toBe(true)
    expect(isMajorCapacity(8000)).toBe(true)
    expect(isMajorCapacity(400)).toBe(false)
    expect(isMajorCapacity(null)).toBe(false)
  })
})
