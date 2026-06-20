// Regression: the positioning deterministic fallback chooses premium-vs-value off
// profile.attributes.priceTier, which build.ts now populates from Google Places priceLevel
// (it was previously never set, so every spot fell through to the "value entry point" play
// the playbook calls tone-deaf for a premium steakhouse).

import { describe, it, expect } from "vitest"
import { positioningSkill } from "@/lib/skills/positioning/skill"
import { priceLevelToTier } from "@/lib/places/format"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier } from "@/lib/insights/dossier/types"

const withPriceTier = (tier: string | undefined): Dossier => ({
  ...competitiveWeekDossier,
  profile: {
    ...competitiveWeekDossier.profile,
    attributes: { ...competitiveWeekDossier.profile.attributes, priceTier: tier },
  },
})

describe("priceLevelToTier", () => {
  it("maps Google price levels to tiers the positioning branch understands", () => {
    expect(priceLevelToTier("PRICE_LEVEL_VERY_EXPENSIVE")).toBe("premium")
    expect(priceLevelToTier("PRICE_LEVEL_EXPENSIVE")).toBe("upscale")
    expect(priceLevelToTier("PRICE_LEVEL_MODERATE")).toBe("mid-market")
    expect(priceLevelToTier("PRICE_LEVEL_INEXPENSIVE")).toBe("value")
    expect(priceLevelToTier(null)).toBeUndefined()
    expect(priceLevelToTier("GARBAGE")).toBeUndefined()
  })
})

describe("positioning fallback — premium vs value branch (priceTier)", () => {
  it("a PREMIUM location answers the undercut with quality, not a discount", () => {
    const plays = positioningSkill.fallback(withPriceTier("premium"))
    expect(plays.length).toBeGreaterThan(0)
    for (const p of plays) {
      expect(p.title.toLowerCase()).toContain("quality")
      expect(p.title.toLowerCase()).not.toContain("value entry")
    }
  })
  it("'upscale' ($$$) also counts as premium", () => {
    const plays = positioningSkill.fallback(withPriceTier("upscale"))
    expect(plays[0].title.toLowerCase()).toContain("quality")
  })
  it("a VALUE / mid-market location gets a value entry point (no quality-defense play)", () => {
    const plays = positioningSkill.fallback(withPriceTier("value"))
    expect(plays.length).toBeGreaterThan(0)
    expect(plays[0].title.toLowerCase()).toContain("value entry")
  })
})
