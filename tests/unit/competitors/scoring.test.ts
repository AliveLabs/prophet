import { describe, it, expect } from "vitest"
import { categoryMatchScore, scoreCompetitor } from "@/lib/providers/scoring"

describe("categoryMatchScore", () => {
  it("never calls a generic category a match (the la Madeleine bug)", () => {
    // Target stored as just "Restaurant" — the old substring check made EVERY
    // "*restaurant*" candidate score 1 → the UI printed "Same cuisine".
    expect(categoryMatchScore("american_restaurant", "Restaurant")).toBe(0.6)
    expect(categoryMatchScore("restaurant", "restaurant")).toBe(0.6)
  })

  it("matches genuinely shared specific categories", () => {
    expect(categoryMatchScore("french_restaurant", "french_restaurant")).toBe(1)
    expect(categoryMatchScore("bakery", "bakery")).toBe(1)
    expect(categoryMatchScore("French restaurant", "french_restaurant")).toBe(1)
  })

  it("scores known specific mismatches down", () => {
    expect(categoryMatchScore("american_restaurant", "french_restaurant")).toBe(0.4)
    expect(categoryMatchScore("hamburger_restaurant", "bakery")).toBe(0.4)
  })

  it("treats missing categories as unknown", () => {
    expect(categoryMatchScore(undefined, "bakery")).toBe(0.6)
    expect(categoryMatchScore("bakery", null)).toBe(0.6)
  })
})

describe("scoreCompetitor", () => {
  it("hard-excludes non-competitor place types", () => {
    const { score, excludedType } = scoreCompetitor({
      distanceMeters: 100,
      category: "bank",
      targetCategory: "bakery",
      types: ["bank", "finance"],
    })
    expect(score).toBe(0)
    expect(excludedType).toBe("bank")
  })

  it("no longer lets sheer proximity claim a cuisine match", () => {
    const close = scoreCompetitor({
      distanceMeters: 100,
      category: "hamburger_restaurant",
      targetCategory: "french_restaurant",
      rating: 4.9,
      reviewCount: 5000,
      types: ["hamburger_restaurant"],
    })
    const categoryFactor = close.factors.find((f) => f.label === "category_match")
    expect(categoryFactor?.value).toBe(0.4)
  })
})
