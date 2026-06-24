import { describe, it, expect } from "vitest"
import {
  ADJACENT_DOMAINS,
  DOMAIN_PREFIXES,
  selectAdjacentSignals,
  type AdjacentSignal,
} from "@/lib/skills/domain-map"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"

// The helper only reads `d.ruleOutputs`, so a minimal dossier with just that field is
// sufficient — and keeps the test focused on adjacency selection, not dossier shape.
function ins(insight_type: string): GeneratedInsight {
  return {
    insight_type,
    title: `title for ${insight_type}`,
    summary: `summary for ${insight_type}`,
    confidence: "medium",
    severity: "info",
    evidence: {},
    recommendations: [],
  }
}

function dossierWith(types: string[]): Dossier {
  return { ruleOutputs: types.map(ins) } as unknown as Dossier
}

describe("ADJACENT_DOMAINS map", () => {
  it("every adjacent domain name is itself a known domain (no dangling edges)", () => {
    for (const [skill, adjacents] of Object.entries(ADJACENT_DOMAINS)) {
      expect(DOMAIN_PREFIXES[skill], `${skill} should be a known domain`).toBeDefined()
      for (const adj of adjacents) {
        expect(DOMAIN_PREFIXES[adj], `${skill} -> ${adj} edge points at an unknown domain`).toBeDefined()
      }
    }
  })

  it("no domain lists itself as adjacent (adjacency means a DIFFERENT domain)", () => {
    for (const [skill, adjacents] of Object.entries(ADJACENT_DOMAINS)) {
      expect(adjacents).not.toContain(skill)
    }
  })
})

describe("selectAdjacentSignals", () => {
  it("returns only signals from the mapped adjacent domains, never the skill's own domain", () => {
    // operations is adjacent to local-demand only.
    const d = dossierWith([
      "traffic.peak_shift", // operations' OWN domain — must be excluded
      "events.new_high_signal_event", // local-demand (adjacent) — included
      "weather.heat_wave", // local-demand (adjacent) — included
      "social.posting_frequency_gap", // marketing — NOT adjacent to operations — excluded
    ])
    const out = selectAdjacentSignals(d, "operations")
    const types = out.map((s) => s.insight_type)
    expect(types).toContain("events.new_high_signal_event")
    expect(types).toContain("weather.heat_wave")
    expect(types).not.toContain("traffic.peak_shift")
    expect(types).not.toContain("social.posting_frequency_gap")
    // every returned signal is tagged with its owning (adjacent) domain
    for (const s of out) expect(s.domain).toBe("local-demand")
  })

  it("round-robins across multiple adjacent domains so the cap can't starve one", () => {
    // local-demand is adjacent to BOTH operations and reputation. With 3 of each and cap 4,
    // the round-robin must take operations[0], reputation[0], operations[1], reputation[1].
    const d = dossierWith([
      "traffic.a",
      "traffic.b",
      "traffic.c",
      "review_velocity_low",
      "rating_drop",
      "review_negative_theme",
    ])
    const out = selectAdjacentSignals(d, "local-demand", 4)
    expect(out.length).toBe(4)
    const domains = out.map((s) => s.domain)
    // both adjacent domains are represented (not all 4 from whichever sorted first)
    expect(domains.filter((x) => x === "operations").length).toBe(2)
    expect(domains.filter((x) => x === "reputation").length).toBe(2)
  })

  it("respects the cap", () => {
    const d = dossierWith(["events.a", "events.b", "events.c", "weather.x", "weather.y"])
    expect(selectAdjacentSignals(d, "operations", 2).length).toBe(2)
    expect(selectAdjacentSignals(d, "operations", 0)).toEqual([])
    expect(selectAdjacentSignals(d, "operations", -5)).toEqual([])
  })

  it("graceful: unknown skill id yields no adjacency (no throw, no regression)", () => {
    const d = dossierWith(["events.a", "traffic.b", "social.c"])
    expect(selectAdjacentSignals(d, "convergence")).toEqual([]) // mapped nowhere
    expect(selectAdjacentSignals(d, "food-pairing")).toEqual([]) // expert, not in the map
    expect(selectAdjacentSignals(d, "totally-made-up")).toEqual([])
  })

  it("graceful: returns [] when no adjacent signals are present (so the prompt is unchanged)", () => {
    // operations is adjacent only to local-demand; this dossier has none of those.
    const d = dossierWith(["traffic.only", "social.only", "rating_only"])
    expect(selectAdjacentSignals(d, "operations")).toEqual([])
  })

  it("graceful: empty dossier yields []", () => {
    expect(selectAdjacentSignals(dossierWith([]), "marketing")).toEqual([])
  })

  it("carries title + summary through for prompt use", () => {
    const d = dossierWith(["events.new_high_signal_event"])
    const out: AdjacentSignal[] = selectAdjacentSignals(d, "operations")
    expect(out[0]).toMatchObject({
      domain: "local-demand",
      insight_type: "events.new_high_signal_event",
      title: "title for events.new_high_signal_event",
      summary: "summary for events.new_high_signal_event",
    })
  })
})
