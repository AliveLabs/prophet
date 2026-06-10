import { describe, it, expect } from "vitest"
import { classifyEventMagnitude, classifyEventRole, isLocalDemand, PROXIMITY } from "@/lib/events/relevance"
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
