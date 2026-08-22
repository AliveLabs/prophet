import { describe, expect, it } from "vitest"
import { resolveUsTimezone, toStateCode, US_FALLBACK_ZONE } from "@/lib/geo/us-timezone"

// ── ALT-739 ─────────────────────────────────────────────────────────────────────────────────
// Every locations row in prod carried America/New_York and NOT ONE was Eastern. Both onboarding
// insert paths hardcoded it; the two form paths defaulted to it. That defeated the local-morning
// build stagger entirely: the whole fleet fired in one burst, which is the self-contention the
// stagger exists to prevent.
//
// The five real production locations are pinned first, because those are the rows this shipped
// wrong, and a fix that does not get them right is not a fix.

describe("resolveUsTimezone: the five real production locations (ALT-739)", () => {
  const REAL = [
    { name: "Bush's Chicken Forney Texas", region: "Texas", lat: 32.7285177, lng: -96.4593939, want: "America/Chicago" },
    { name: "Fog Harbor Fish House", region: "California", lat: 37.8089961, lng: -122.4102878, want: "America/Los_Angeles" },
    { name: "Raising Cane's Chicken Fingers", region: "Texas", lat: 32.7553472, lng: -97.097599, want: "America/Chicago" },
    { name: "Sugarbacon Proper Kitchen", region: "Texas", lat: 33.198213, lng: -96.6170964, want: "America/Chicago" },
    { name: "V's Italiano Ristorante", region: "Missouri", lat: 39.0504308, lng: -94.4504543, want: "America/Chicago" },
  ]

  for (const l of REAL) {
    it(`${l.name} resolves to ${l.want}`, () => {
      expect(resolveUsTimezone(l).timezone).toBe(l.want)
    })
  }

  it("not one of them is Eastern, which is what shipped", () => {
    for (const l of REAL) {
      expect(resolveUsTimezone(l).timezone).not.toBe("America/New_York")
    }
  })
})

describe("resolveUsTimezone: region parsing", () => {
  it("takes a full state name, which is what Google Places returns", () => {
    expect(toStateCode("Texas")).toBe("TX")
    expect(toStateCode("New Hampshire")).toBe("NH")
    expect(toStateCode("district of columbia")).toBe("DC")
  })

  it("takes a two-letter code", () => {
    expect(toStateCode("tx")).toBe("TX")
    expect(toStateCode(" CA ")).toBe("CA")
  })

  it("returns null for anything it does not recognise", () => {
    for (const v of ["", "  ", "Ontario", "XX", null, undefined]) {
      expect(toStateCode(v)).toBeNull()
    }
  })
})

describe("resolveUsTimezone: single-zone states are exact", () => {
  const CASES: Array<[string, string]> = [
    ["California", "America/Los_Angeles"],
    ["Washington", "America/Los_Angeles"],
    ["Arizona", "America/Phoenix"],
    ["Colorado", "America/Denver"],
    ["Missouri", "America/Chicago"],
    ["New York", "America/New_York"],
    ["Hawaii", "Pacific/Honolulu"],
  ]
  for (const [region, want] of CASES) {
    it(`${region} -> ${want}`, () => {
      const r = resolveUsTimezone({ region })
      expect(r.timezone).toBe(want)
      expect(r.confidence).toBe("state")
    })
  }

  it("Arizona is Phoenix, not Denver, because it keeps standard time year round", () => {
    expect(resolveUsTimezone({ region: "Arizona" }).timezone).toBe("America/Phoenix")
  })
})

describe("resolveUsTimezone: states a timezone line crosses", () => {
  const CASES: Array<[string, string, number, number, string]> = [
    ["Florida", "Miami", 25.76, -80.19, "America/New_York"],
    ["Florida", "Pensacola panhandle", 30.42, -87.22, "America/Chicago"],
    ["Texas", "Dallas", 32.78, -96.8, "America/Chicago"],
    ["Texas", "El Paso", 31.76, -106.49, "America/Denver"],
    ["Indiana", "Indianapolis", 39.77, -86.16, "America/New_York"],
    ["Indiana", "Gary", 41.59, -87.35, "America/Chicago"],
    ["Tennessee", "Nashville", 36.16, -86.78, "America/Chicago"],
    ["Tennessee", "Knoxville", 35.96, -83.92, "America/New_York"],
    ["Idaho", "Boise", 43.62, -116.2, "America/Denver"],
    ["Idaho", "Coeur d'Alene panhandle", 47.68, -116.78, "America/Los_Angeles"],
    ["Oregon", "Portland", 45.52, -122.68, "America/Los_Angeles"],
    ["Michigan", "Detroit", 42.33, -83.05, "America/New_York"],
    ["Kansas", "Wichita", 37.69, -97.34, "America/Chicago"],
  ]
  for (const [region, place, lat, lng, want] of CASES) {
    it(`${region} / ${place} -> ${want}`, () => {
      expect(resolveUsTimezone({ region, lat, lng }).timezone).toBe(want)
    })
  }

  it("falls back to the state's majority zone when coordinates are missing, and says so", () => {
    const r = resolveUsTimezone({ region: "Texas" })
    expect(r.timezone).toBe("America/Chicago")
    expect(r.confidence).toBe("split_state")
  })
})

describe("resolveUsTimezone: a fallback is reported as one", () => {
  // The bug was not that Eastern was the fallback. It was that Eastern was asserted SILENTLY, so
  // nothing could tell a real Eastern location from an unresolved one.
  it("reports confidence 'fallback' for an unknown region", () => {
    const r = resolveUsTimezone({ region: "Ontario", lat: 43.65, lng: -79.38 })
    expect(r.timezone).toBe(US_FALLBACK_ZONE)
    expect(r.confidence).toBe("fallback")
  })

  it("reports 'fallback' when there is no region at all", () => {
    expect(resolveUsTimezone({}).confidence).toBe("fallback")
    expect(resolveUsTimezone({ region: null, lat: 32.7, lng: -96.4 }).confidence).toBe("fallback")
  })

  it("never reports a fallback as exact", () => {
    for (const region of [null, "", "Ontario", "ZZ"]) {
      expect(resolveUsTimezone({ region }).confidence).not.toBe("state")
    }
  })
})

describe("resolveUsTimezone: every zone it can return is a real IANA name", () => {
  it("resolves to a zone Intl accepts", () => {
    const regions = [
      "California", "Texas", "Florida", "Arizona", "Hawaii", "Alaska", "Indiana",
      "Michigan", "Idaho", "Oregon", "Nevada", "Kansas", "Missouri", "New York",
      "Washington", "Puerto Rico", "Ontario",
    ]
    for (const region of regions) {
      const { timezone } = resolveUsTimezone({ region, lat: 40, lng: -100 })
      expect(
        () => new Intl.DateTimeFormat("en-US", { timeZone: timezone }),
        `${region} produced an invalid zone: ${timezone}`,
      ).not.toThrow()
    }
  })
})
