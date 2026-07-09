import { describe, it, expect } from "vitest"
import { mergeNormalizedEvents } from "@/lib/events/merge"
import type { NormalizedEvent } from "@/lib/events/types"

function nev(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    uid: Math.random().toString(16).slice(2, 18),
    title: "Texas Rangers vs Houston Astros",
    startDatetime: "2026-07-10T19:05",
    venue: { name: "Globe Life Field", address: "734 Stadium Dr" },
    source: "dataforseo_google_events",
    keyword: "events",
    dateRange: "week",
    ...overrides,
  }
}

describe("mergeNormalizedEvents (hybrid)", () => {
  it("merges a matched pair — grounded identity wins, DataForSEO breadth fills", () => {
    const df = nev({
      // Same title-stem + date + venue as the grounded twin → they collapse to one.
      title: "Texas Rangers vs Houston Astros",
      type: "other",
      startDatetime: "2026-07-10T00:00", // scraped, wrong time — grounded's should win
      imageUrl: "https://img/df.jpg",
      ticketsAndInfo: [{ title: "Tickets", url: "https://df/tix", domain: "df" }],
      origin: "dataforseo",
    })
    const grounded = nev({
      title: "Texas Rangers vs Houston Astros",
      type: "sports",
      startDatetime: "2026-07-10T19:05",
      ticketsAndInfo: undefined,
      origin: "grounded",
    })
    const out = mergeNormalizedEvents([df], [grounded])
    expect(out).toHaveLength(1)
    const m = out[0]
    expect(m.title).toBe("Texas Rangers vs Houston Astros") // grounded identity
    expect(m.type).toBe("sports")
    expect(m.startDatetime).toBe("2026-07-10T19:05")
    expect(m.imageUrl).toBe("https://img/df.jpg") // DataForSEO enrichment preserved
    expect(m.ticketsAndInfo?.[0].url).toBe("https://df/tix") // DataForSEO ticket breadth kept
    expect(m.origin).toBe("grounded")
  })

  it("keeps grounded-only and DataForSEO-only events (breadth + accuracy)", () => {
    const dfOnly = nev({ title: "Local Trivia Night", venue: { name: "Corner Pub" }, startDatetime: "2026-07-11T20:00", origin: "dataforseo" })
    const groundedOnly = nev({ title: "Morgan Wallen Tour", type: "concert", venue: { name: "AT&T Stadium" }, startDatetime: "2026-07-12T20:00", origin: "grounded" })
    const out = mergeNormalizedEvents([dfOnly], [groundedOnly])
    expect(out).toHaveLength(2)
    const titles = out.map((e) => e.title)
    expect(titles).toContain("Local Trivia Night")
    expect(titles).toContain("Morgan Wallen Tour")
  })

  it("leads with grounded (accuracy) then DataForSEO-only (breadth)", () => {
    const dfOnly = nev({ title: "Trivia", venue: { name: "Pub" }, startDatetime: "2026-07-11T20:00" })
    const grounded = nev({ title: "Rangers Game", type: "sports", venue: { name: "Globe Life Field" }, startDatetime: "2026-07-10T19:05" })
    const out = mergeNormalizedEvents([dfOnly], [grounded])
    expect(out[0].title).toBe("Rangers Game")
  })

  it("dedupes duplicate grounded events", () => {
    const g1 = nev({ startDatetime: "2026-07-10T19:05" })
    const g2 = nev({ startDatetime: "2026-07-10T19:40" }) // time drift, same day/venue/title
    const out = mergeNormalizedEvents([], [g1, g2])
    expect(out).toHaveLength(1)
  })

  it("returns DataForSEO events unchanged when there is no grounded input", () => {
    const df = nev({ title: "Trivia", venue: { name: "Pub" } })
    const out = mergeNormalizedEvents([df], [])
    expect(out).toHaveLength(1)
    expect(out[0].origin).toBe("dataforseo")
  })
})
