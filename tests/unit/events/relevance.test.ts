import { describe, it, expect } from "vitest"
import {
  classifyEventMagnitude,
  classifyEventRole,
  isLocalDemand,
  PROXIMITY,
  DENSITY_RINGS,
  proximityRingFor,
} from "@/lib/events/relevance"
import { haversineMiles } from "@/lib/events/geo"
import { checkEventGeoSanity } from "@/lib/eval/checks"
import type { EnrichedRecommendation } from "@/lib/skills/types"

describe("haversineMiles", () => {
  it("measures Forney → American Airlines Center ≈ 20+ miles", () => {
    // Bush's Chicken Forney (~32.7457, -96.4720) → AAC Dallas (32.7904, -96.8103)
    const d = haversineMiles(32.7457, -96.472, 32.7904, -96.8103)
    expect(d).toBeGreaterThan(15)
    expect(d).toBeLessThan(30)
  })
})

describe("classifyEventMagnitude", () => {
  it("NBA playoff game at an arena = major", () => {
    expect(
      classifyEventMagnitude({
        title: "Dallas Mavericks Playoff Game 4",
        venue: { name: "American Airlines Center" },
        ticketsAndInfo: [{ domain: "ticketmaster.com" }, { domain: "nba.com" }],
      })
    ).toBe("major")
  })
  it("comedy night at a club = minor; festival = moderate", () => {
    expect(classifyEventMagnitude({ title: "Misfits Comedy Tour", venue: { name: "Jax Comedy House" }, ticketsAndInfo: [] })).toBe("minor")
    expect(classifyEventMagnitude({ title: "BSW Juneteenth Festival", venue: { name: "Lancaster Community Park" }, ticketsAndInfo: [] })).toBe("moderate")
  })
})

describe("classifyEventRole — Bryan's proximity spec", () => {
  it("blocks away → local_foot; in town → local_traffic", () => {
    expect(classifyEventRole(0.3, "minor")).toBe("local_foot")
    expect(classifyEventRole(2.1, "minor")).toBe("local_traffic")
    expect(PROXIMITY.trafficMiles).toBeLessThanOrEqual(5)
  })
  it("far + MAJOR (Mavs game 22mi out) → metro_hook, never local demand", () => {
    const role = classifyEventRole(22.4, "major")
    expect(role).toBe("metro_hook")
    expect(isLocalDemand(role)).toBe(false)
  })
  it("far + minor/moderate → out_of_area (invisible)", () => {
    expect(classifyEventRole(11.2, "minor")).toBe("out_of_area")
    expect(classifyEventRole(24.8, "moderate")).toBe("out_of_area")
  })
  it("no geocode → ungeocoded (anti-fabrication: no local claims without a measured distance)", () => {
    expect(classifyEventRole(null, "major")).toBe("ungeocoded")
    expect(isLocalDemand(classifyEventRole(undefined, "minor"))).toBe(false)
  })
})

describe("R2 density-scaled relevance ring (§3.3)", () => {
  it("ring breakpoints: dense_urban 0.3/1, suburban 0.5/3 (= today), rural 0.75/5", () => {
    expect(DENSITY_RINGS.dense_urban).toEqual({ footMiles: 0.3, trafficMiles: 1.0 })
    expect(DENSITY_RINGS.suburban).toEqual({ footMiles: 0.5, trafficMiles: 3.0 })
    expect(DENSITY_RINGS.rural).toEqual({ footMiles: 0.75, trafficMiles: 5.0 })
    // The suburban ring IS the legacy PROXIMITY constant — proof the no-Census path is unchanged.
    expect(DENSITY_RINGS.suburban.footMiles).toBe(PROXIMITY.footMiles)
    expect(DENSITY_RINGS.suburban.trafficMiles).toBe(PROXIMITY.trafficMiles)
  })

  it("unknown/undefined density class → suburban ring (BYTE-IDENTICAL to today)", () => {
    expect(proximityRingFor(undefined)).toEqual(DENSITY_RINGS.suburban)
    expect(proximityRingFor(null)).toEqual(DENSITY_RINGS.suburban)
    // Same distances classify the same with-no-class vs with-suburban — and same as today.
    for (const d of [0.2, 0.5, 0.6, 2.9, 3.0, 3.1, 12]) {
      const noClass = classifyEventRole(d, "minor")
      const subClass = classifyEventRole(d, "minor", { densityClass: "suburban" })
      expect(subClass).toBe(noClass)
    }
  })

  it("a dense_urban location gets the TIGHTER 0.3/1mi ring", () => {
    // 0.4mi: suburban=local_foot, dense_urban=local_traffic (past the 0.3 foot ring)
    expect(classifyEventRole(0.4, "minor")).toBe("local_foot")
    expect(classifyEventRole(0.4, "minor", { densityClass: "dense_urban" })).toBe("local_traffic")
    // 1.5mi: suburban=local_traffic, dense_urban=out_of_area (past the 1mi traffic ring)
    expect(classifyEventRole(1.5, "minor", { densityClass: "dense_urban" })).toBe("out_of_area")
    // 0.25mi still walk-in even in a dense core
    expect(classifyEventRole(0.25, "minor", { densityClass: "dense_urban" })).toBe("local_foot")
  })

  it("a rural location gets the WIDER 0.75/5mi ring", () => {
    // 0.6mi: suburban=local_traffic, rural=local_foot (within the 0.75 foot ring)
    expect(classifyEventRole(0.6, "minor")).toBe("local_traffic")
    expect(classifyEventRole(0.6, "minor", { densityClass: "rural" })).toBe("local_foot")
    // 4mi: suburban=out_of_area (minor), rural=local_traffic (within the 5mi ring)
    expect(classifyEventRole(4, "minor")).toBe("out_of_area")
    expect(classifyEventRole(4, "minor", { densityClass: "rural" })).toBe("local_traffic")
  })

  it("route events use the density-scaled TRAFFIC ring for the corridor", () => {
    // 4mi route: suburban=out_of_area, rural=route_corridor (within 5mi)
    expect(classifyEventRole(4, "minor", { isRoute: true })).toBe("out_of_area")
    expect(classifyEventRole(4, "minor", { isRoute: true, densityClass: "rural" })).toBe("route_corridor")
    // 1.5mi route in a dense core: past the 1mi ring → out_of_area
    expect(classifyEventRole(1.5, "minor", { isRoute: true, densityClass: "dense_urban" })).toBe("out_of_area")
  })
})

describe("checkEventGeoSanity — the eval backstop", () => {
  const play = (over: Partial<EnrichedRecommendation>): EnrichedRecommendation =>
    ({
      title: "t", rationale: "r", skillId: "local-demand", ownerRole: "owner", kind: "prepare",
      recipe: [], confidence: "high", evidenceRefs: ["events.new_high_signal_event"],
      knowledgeVersion: "x@v1",
      ...over,
    }) as EnrichedRecommendation

  it("FAILS the pretest scenario: staffing play from far-away events only", () => {
    const v = checkEventGeoSanity(play({ kind: "prepare", title: "Staff up for Saturday playoff game traffic" }), 0, {
      localEventCount: 0,
      metroHookCount: 1,
    })
    expect(v.some((x) => x.code === "event_geo_demand_claim")).toBe(true)
  })

  it("allows a marketing tie-in from a metro hook, but not at high leverage", () => {
    const ok = checkEventGeoSanity(play({ kind: "capitalize", leverage: { label: "low", basisInternal: "tie-in" } }), 0, { localEventCount: 0, metroHookCount: 1 })
    expect(ok).toEqual([])
    const over = checkEventGeoSanity(play({ kind: "capitalize", leverage: { label: "high", basisInternal: "x" } }), 0, { localEventCount: 0, metroHookCount: 1 })
    expect(over.some((x) => x.code === "event_geo_overweighted")).toBe(true)
  })

  it("flags event-citing plays when there are no events at all; passes with local events", () => {
    const none = checkEventGeoSanity(play({}), 0, { localEventCount: 0, metroHookCount: 0 })
    expect(none.some((x) => x.code === "event_geo_ungrounded")).toBe(true)
    expect(checkEventGeoSanity(play({}), 0, { localEventCount: 2, metroHookCount: 0 })).toEqual([])
  })
})
