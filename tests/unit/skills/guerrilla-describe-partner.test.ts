// T6 — describePartnerForPrompt(): the partner taxonomy is pre-translated into plain owner prose
// BEFORE it enters any prompt. Verifies the ALC Dance Studios defect can no longer occur: no raw
// taxonomy names, no "…band" size brackets, and the audience is stated as the real people the owner
// pictures (families / members / the congregation).

import { describe, it, expect } from "vitest"
import { describePartnerForPrompt } from "@/lib/skills/guerrilla-marketing/skill"
import type { PartnerEntitySummary } from "@/lib/insights/dossier/types"

function partner(over: Partial<PartnerEntitySummary> = {}): PartnerEntitySummary {
  return {
    name: "ALC Dance Studios",
    partnerType: "gym", // a dance studio catalogs as a gym/studio (members)
    partnerLabel: "gym or fitness studio",
    distanceMi: 0.2,
    sizeBand: "medium",
    sizeProxyLow: 40,
    sizeProxyHigh: 60,
    sizeProxyKind: "membership band",
    ...over,
  }
}

describe("describePartnerForPrompt — plain owner prose (T6)", () => {
  it("NEVER echoes the internal taxonomy words into the prompt string", () => {
    // The exact leaks the 2026-07-03 voice audit found in live copy.
    for (const p of [
      partner(),
      partner({ partnerType: "school", partnerLabel: "school / PTA", sizeProxyKind: "enrollment band" }),
      partner({ partnerType: "church", partnerLabel: "church / congregation", sizeProxyKind: "congregation band" }),
    ]) {
      const s = describePartnerForPrompt(p)
      expect(s).not.toMatch(/\bband\b/i) // the band rule: never a size bracket
      expect(s).not.toContain("enrollment band")
      expect(s).not.toContain("membership band")
      expect(s).not.toContain("congregation band")
      expect(s).not.toContain("school / PTA") // raw partnerLabel value
      expect(s).not.toMatch(/\banchor\b/i)
      expect(s).not.toMatch(/\bsizeBand\b|\bsizeProxyKind\b|\bpartnerLabel\b/)
    }
  })

  it("states the audience as the real people the owner pictures (numbers, no ordinal codes)", () => {
    // A gym/studio → members; the ALC case renders as families? No — a studio is members here, but the
    // point is plain people + a plain number range, never a band.
    const gym = describePartnerForPrompt(partner())
    expect(gym).toContain("roughly 40-60 members")
    expect(gym).toContain("0.2 miles away")

    const school = describePartnerForPrompt(
      partner({ name: "Forney Elementary", partnerType: "school", partnerLabel: "school / PTA", sizeProxyKind: "enrollment band", sizeProxyLow: 300, sizeProxyHigh: 700 }),
    )
    expect(school).toContain("roughly 300-700 families")
    expect(school).toContain("a nearby school")

    const church = describePartnerForPrompt(
      partner({ name: "Grace Community", partnerType: "church", partnerLabel: "church / congregation", sizeProxyKind: "congregation band", sizeProxyLow: 150, sizeProxyHigh: 1200 }),
    )
    expect(church).toContain("members of the congregation")
    expect(church).toContain("a nearby church")
  })

  it("falls back to a plain size word (never an ordinal code) when the numeric proxy is absent", () => {
    const s = describePartnerForPrompt(partner({ sizeProxyLow: null, sizeProxyHigh: null, sizeBand: "large" }))
    expect(s).toContain("a large group of members")
    expect(s).not.toMatch(/\bband\b/i)
    expect(s).not.toContain("large\"") // not the raw ordinal token
  })

  it("renders one clean sentence for the exact ALC Dance Studios defect input", () => {
    // The bad copy justified itself with taxonomy; the new descriptor is pure owner language.
    const s = describePartnerForPrompt(partner())
    expect(s).toBe("ALC Dance Studios, a nearby gym or fitness studio about 0.2 miles away, with roughly 40-60 members.")
  })
})
