import { describe, it, expect } from "vitest"
import { normalizeGroundedEvents, cleanGroundedUrl } from "@/lib/events/normalize-grounded"
import type { GroundedEvent } from "@/lib/providers/gemini/google-events"

function ev(overrides: Partial<GroundedEvent> = {}): GroundedEvent {
  return {
    title: "Texas Rangers vs Houston Astros",
    type: "sports",
    venue: { name: "Globe Life Field", address: "734 Stadium Dr", city: "Arlington" },
    startDatetime: "2026-07-10T19:05",
    endDatetime: null,
    ticketed: true,
    ticketUrl: "https://www.mlb.com/rangers/tickets",
    officialUrl: "https://www.mlb.com/rangers",
    ...overrides,
  }
}

describe("normalizeGroundedEvents", () => {
  it("maps a grounded event onto NormalizedEvent with source-agnostic fields", () => {
    const snap = normalizeGroundedEvents([ev()], { queries: [], horizon: "month" })
    expect(snap.events).toHaveLength(1)
    const e = snap.events[0]
    expect(e.source).toBe("dataforseo_google_events") // read-path compatibility
    expect(e.origin).toBe("grounded")
    expect(e.type).toBe("sports")
    expect(e.title).toBe("Texas Rangers vs Houston Astros")
    expect(e.startDatetime).toBe("2026-07-10T19:05")
    expect(e.venue?.name).toBe("Globe Life Field")
    expect(e.magnitude).toBe("moderate") // ticketed seed (annotate overrides from catalog capacity)
    expect(e.ticketsAndInfo?.length).toBeGreaterThan(0)
    expect(e.uid).toMatch(/^[0-9a-f]{16}$/)
  })

  it("DROPS an event whose date is ambiguous (never mis-dates)", () => {
    const snap = normalizeGroundedEvents([ev({ startDatetime: "July 31" })], { queries: [] })
    expect(snap.events).toHaveLength(0)
  })

  it("dedupes two runs of the same event to one", () => {
    const snap = normalizeGroundedEvents([ev(), ev({ startDatetime: "2026-07-10T19:35" })], { queries: [] })
    expect(snap.events).toHaveLength(1) // time drift collapses via the stable uid
  })

  it("builds a summary and rolls totals", () => {
    const snap = normalizeGroundedEvents([ev(), ev({ title: "Concert", type: "concert", venue: { name: "Dickies Arena" }, startDatetime: "2026-07-12T20:00" })], { queries: [] })
    expect(snap.summary.totalEvents).toBe(2)
    expect(snap.summary.byDate["2026-07-10"]).toBe(1)
  })
})

describe("cleanGroundedUrl", () => {
  it("passes through a clean http(s) url", () => {
    expect(cleanGroundedUrl("https://www.mlb.com/rangers")).toBe("https://www.mlb.com/rangers")
  })
  it("unwraps a vertex grounding redirect when it carries an inner url", () => {
    expect(
      cleanGroundedUrl("https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc?url=https%3A%2F%2Fexample.com%2Fe"),
    ).toBe("https://example.com/e")
  })
  it("drops an opaque redirect with no inner url", () => {
    expect(cleanGroundedUrl("https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque")).toBeUndefined()
  })
  it("drops junk / non-http", () => {
    expect(cleanGroundedUrl("not a url")).toBeUndefined()
    expect(cleanGroundedUrl(null)).toBeUndefined()
  })
})
