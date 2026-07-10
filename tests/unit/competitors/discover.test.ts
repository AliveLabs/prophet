import { describe, it, expect } from "vitest"
import {
  buildTargetIdentity,
  buildRerankPrompt,
  parseRerank,
  sanitizeWhy,
  discoveryTypeTiles,
  RESTAURANT_TYPE_TILES,
} from "@/lib/competitors/discover"
import type { DiscoveredCompetitor } from "@/lib/places/google"

const details = {
  displayName: { text: "la Madeleine" },
  primaryType: "restaurant",
  editorialSummary: {
    text: "Quaint French cafe chain serving rustic country fare, espresso & fresh-baked baguettes.",
  },
  servesBreakfast: true,
  servesBrunch: true,
  servesLunch: true,
  priceLevel: "PRICE_LEVEL_MODERATE",
}

function candidate(overrides: Partial<DiscoveredCompetitor> = {}): DiscoveredCompetitor {
  return {
    placeId: "p1",
    name: "Panera Bread",
    primaryType: "cafe",
    types: ["cafe", "restaurant"],
    rating: 4.2,
    reviewCount: 900,
    priceLevel: "PRICE_LEVEL_MODERATE",
    address: "123 Mockingbird Ln",
    distanceMeters: 744,
    ...overrides,
  }
}

describe("buildTargetIdentity", () => {
  it("pulls the identity signals from place details", () => {
    const id = buildTargetIdentity("fallback name", details, "Restaurant")
    expect(id.name).toBe("la Madeleine")
    expect(id.editorial).toMatch(/French cafe chain/)
    expect(id.serves).toEqual(["breakfast", "brunch", "lunch"])
    expect(id.priceLevel).toBe("PRICE_LEVEL_MODERATE")
  })

  it("degrades to name + stored category when details are unavailable", () => {
    const id = buildTargetIdentity("la Madeleine", null, "french_restaurant")
    expect(id.name).toBe("la Madeleine")
    expect(id.category).toBe("french restaurant")
    expect(id.editorial).toBeNull()
    expect(id.serves).toEqual([])
  })
})

describe("discoveryTypeTiles", () => {
  it("sweeps the food families for the restaurant vertical (and by default)", () => {
    expect(discoveryTypeTiles("restaurant")).toBe(RESTAURANT_TYPE_TILES)
    expect(discoveryTypeTiles(undefined)).toBe(RESTAURANT_TYPE_TILES)
  })

  it("uses a single tile for other verticals", () => {
    expect(discoveryTypeTiles("liquor_store")).toEqual([["liquor_store"]])
  })
})

describe("buildRerankPrompt", () => {
  it("names the target's identity and lists every candidate with its index", () => {
    const identity = buildTargetIdentity("la Madeleine", details, null)
    const pool = [candidate(), candidate({ placeId: "p2", name: "The Finch" })]
    const prompt = buildRerankPrompt(identity, pool)
    expect(prompt).toContain("la Madeleine")
    expect(prompt).toContain("French cafe chain")
    expect(prompt).toContain("breakfast, brunch, lunch")
    expect(prompt).toContain("0 | Panera Bread")
    expect(prompt).toContain("1 | The Finch")
    // The whys become customer-facing copy — jargon must be banned in-prompt.
    expect(prompt).toMatch(/no industry jargon/i)
    expect(prompt).toMatch(/no em dashes/i)
  })
})

describe("parseRerank", () => {
  it("returns a clamped index → score/why map", () => {
    const map = parseRerank(
      {
        rankings: [
          { i: 0, score: 82, why: "Same bakery-café crowd." },
          { i: 1, score: 150 },
          { i: 2, score: -10, why: "   " },
          { i: 3, score: 40.6 },
        ],
      },
      4
    )
    expect(map).not.toBeNull()
    expect(map!.get(0)).toEqual({ score: 82, why: "Same bakery-café crowd." })
    expect(map!.get(1)).toEqual({ score: 100, why: null })
    expect(map!.get(2)).toEqual({ score: 0, why: null })
    expect(map!.get(3)!.score).toBe(41)
  })

  it("skips malformed entries and out-of-range indices", () => {
    const map = parseRerank(
      {
        rankings: [
          { i: 0, score: 70 },
          { i: 9, score: 50 }, // out of range
          { i: 1.5, score: 50 }, // non-integer
          { i: 1, score: "high" }, // non-numeric score
          null,
          { i: 1, score: 60 },
        ],
      },
      2
    )
    expect(map).not.toBeNull()
    expect([...map!.keys()].sort()).toEqual([0, 1])
  })

  it("rejects unusable payloads entirely (caller falls back to heuristics)", () => {
    expect(parseRerank(null, 4)).toBeNull()
    expect(parseRerank("nope", 4)).toBeNull()
    expect(parseRerank({ rankings: [] }, 4)).toBeNull()
    // Covering under half the pool = unreliable ranking.
    expect(parseRerank({ rankings: [{ i: 0, score: 50 }] }, 4)).toBeNull()
  })
})

describe("sanitizeWhy", () => {
  it("passes plain language through", () => {
    expect(sanitizeWhy("Same fresh-baked breads and soups a block away.")).toBe(
      "Same fresh-baked breads and soups a block away."
    )
  })

  it("rewrites em/en dashes (brand canon bans them)", () => {
    expect(sanitizeWhy("Bakery café — same morning crowd")).toBe(
      "Bakery café, same morning crowd"
    )
  })

  it("rejects chef lingo — the UI then uses its own deterministic line", () => {
    expect(sanitizeWhy("Their back of house turns out similar pastries")).toBeNull()
  })

  it("rejects empty and over-long lines", () => {
    expect(sanitizeWhy(null)).toBeNull()
    expect(sanitizeWhy("   ")).toBeNull()
    expect(sanitizeWhy("x".repeat(200))).toBeNull()
  })
})
