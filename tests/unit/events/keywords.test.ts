import { describe, it, expect } from "vitest"
import { buildEventQueryPlan, selectProbeVenues } from "@/lib/events/keywords"
import type { CatalogVenue } from "@/lib/events/venue-catalog"

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

const smallTheater: CatalogVenue = {
  placeId: "y",
  name: "Tiny Theater",
  primaryType: "performing_arts_theater",
  lat: 32.74,
  lng: -97.09,
  distanceMi: 1.2,
  capacityLow: 250,
  capacityHigh: 400,
  capacityConfidence: "prior",
  aliases: [],
}

describe("selectProbeVenues", () => {
  it("includes an in-ring stadium and ranks biggest-capacity first", () => {
    const out = selectProbeVenues([smallTheater, stadium])
    expect(out[0].name).toBe("AT&T Stadium")
  })
  it("excludes a far, small venue (15mi+ non-major)", () => {
    const far: CatalogVenue = { ...smallTheater, distanceMi: 20 }
    expect(selectProbeVenues([far])).toHaveLength(0)
  })
})

describe("buildEventQueryPlan", () => {
  it("mid tier probes the stadium BY NAME (month horizon) + keeps a generic net", () => {
    const plan = buildEventQueryPlan({ catalog: [stadium], maxQueries: 2, dateKey: "2026-06-22" })
    expect(plan).toHaveLength(2)
    expect(plan[0]).toEqual({ keyword: "AT&T Stadium", dateRange: "month" })
    expect(plan.some((q) => q.keyword === "events")).toBe(true)
  })

  it("entry tier (1 query) substitutes the venue probe for the generic net", () => {
    const plan = buildEventQueryPlan({ catalog: [stadium], maxQueries: 1, dateKey: "2026-06-22" })
    expect(plan).toEqual([{ keyword: "AT&T Stadium", dateRange: "month" }])
  })

  it("falls back to MORE than just 'events', on the WEEK horizon (no catalog)", () => {
    const plan = buildEventQueryPlan({ catalog: [], maxQueries: 2, dateKey: "2026-06-22" })
    expect(plan[0].keyword).toBe("events")
    expect(plan.length).toBe(2)
    // A second, distinct targeted keyword — not a duplicate generic.
    expect(plan[1].keyword).not.toBe("events")
    // Weekday events matter (Thu/Mon concerts, MNF) — nothing uses the weekend-only horizon.
    expect(plan.every((q) => q.dateRange !== "weekend")).toBe(true)
    expect(plan.every((q) => q.dateRange === "week")).toBe(true)
  })

  it("entry-tier fallback is a single broad 'events' net on the week horizon", () => {
    const plan = buildEventQueryPlan({ catalog: [], maxQueries: 1, dateKey: "2026-06-22" })
    expect(plan).toEqual([{ keyword: "events", dateRange: "week" }])
  })

  it("never exceeds the query budget", () => {
    expect(buildEventQueryPlan({ catalog: [stadium], maxQueries: 1, dateKey: "2026-06-22" })).toHaveLength(1)
    expect(buildEventQueryPlan({ catalog: [], maxQueries: 0, dateKey: "2026-06-22" })).toHaveLength(0)
  })

  it("is deterministic for the same date", () => {
    const a = buildEventQueryPlan({ catalog: [], maxQueries: 2, dateKey: "2026-06-22" })
    const b = buildEventQueryPlan({ catalog: [], maxQueries: 2, dateKey: "2026-06-22" })
    expect(a).toEqual(b)
  })
})
