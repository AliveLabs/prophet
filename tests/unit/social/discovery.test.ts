import { describe, it, expect } from "vitest"
import {
  selectDiscoveryTargets,
  handleNameSimilarity,
  extractHandlesFromText,
  extractAggregatorUrls,
} from "@/lib/social/enrich"

describe("selectDiscoveryTargets", () => {
  const entities = [
    { id: "loc", website: "https://wagyu.com", name: "Wagyu House" },
    { id: "comp-verified", website: "https://gyukaku.com", name: "Gyu-Kaku" },
    { id: "comp-unverified", website: "https://terilli.com", name: "Terilli's" },
    { id: "comp-no-site", website: null, name: "Raising Cane's" },
    { id: "comp-nothing", website: null, name: null },
  ]

  it("re-discovers entities lacking a verified handle when there is anything to search with", () => {
    const verified = new Set(["comp-verified:instagram", "comp-verified:facebook", "comp-verified:tiktok"])
    const targets = selectDiscoveryTargets(entities, verified).map((e) => e.id)
    expect(targets).toEqual(["loc", "comp-unverified", "comp-no-site"])
  })

  it("name-only entities are now targeted (SERP needs no website — the Bush's Forney gap)", () => {
    const targets = selectDiscoveryTargets(entities, new Set())
    expect(targets.find((e) => e.id === "comp-no-site")).toBeDefined()
  })

  it("excludes entities verified on every platform, keeps entities with neither website nor name excluded", () => {
    const verified = new Set(["comp-verified:instagram", "comp-verified:facebook", "comp-verified:tiktok"])
    const targets = selectDiscoveryTargets(entities, verified)
    expect(targets.find((e) => e.id === "comp-verified")).toBeUndefined()
    expect(targets.find((e) => e.id === "comp-nothing")).toBeUndefined()
  })

  // ALT-198 — Raising Cane's had ONE platform (e.g. Instagram) added + verified
  // manually early on, which silently blocked Facebook/TikTok from EVER being
  // auto-discovered: the old per-ENTITY verified gate excluded the whole entity
  // once it had any verified handle, so partially-verified entities never got
  // re-scanned for their still-missing platforms.
  it("keeps re-discovering an entity that is verified on only SOME platforms (ALT-198)", () => {
    const verified = new Set(["loc:instagram"]) // own location: IG verified, FB/TikTok missing
    const targets = selectDiscoveryTargets(entities, verified).map((e) => e.id)
    expect(targets).toContain("loc")
  })
})

describe("handleNameSimilarity", () => {
  it("scores concatenated-name handles high", () => {
    expect(handleNameSimilarity("bushschickenforney", "Bush's Chicken")).toBeGreaterThanOrEqual(0.9)
    expect(handleNameSimilarity("raisingcanes", "Raising Cane's Chicken Fingers")).toBeGreaterThanOrEqual(0.5)
  })

  it("scores junk handles low (the naadaaaaaaaaaa case)", () => {
    expect(handleNameSimilarity("naadaaaaaaaaaa", "Nada")).toBeLessThan(0.5)
    expect(handleNameSimilarity("foodlover99", "Bush's Chicken")).toBeLessThan(0.5)
  })

  it("handles separators in handles", () => {
    expect(handleNameSimilarity("golden.chick_forney", "Golden Chick")).toBeGreaterThanOrEqual(0.9)
  })
})

describe("extractHandlesFromText", () => {
  it("extracts platform handles from mixed text and dedupes", () => {
    const text = [
      "Follow us https://instagram.com/bushschicken and https://www.instagram.com/bushschicken/",
      "https://facebook.com/bushschickenforney",
      "https://www.tiktok.com/@bushs.chicken",
      "not a profile: https://instagram.com/p/Cxyz123",
    ].join("\n")
    const found = extractHandlesFromText(text, "serp", 0.7)
    expect(found).toHaveLength(3)
    expect(found.map((h) => `${h.platform}:${h.handle}`)).toEqual([
      "instagram:bushschicken",
      "facebook:bushschickenforney",
      "tiktok:bushs.chicken",
    ])
    expect(found.every((h) => h.method === "serp" && h.confidence === 0.7)).toBe(true)
  })
})

describe("extractAggregatorUrls", () => {
  it("finds link-in-bio aggregators, capped at two", () => {
    const bio = "Best chicken in town 🍗 linktr.ee nope https://linktr.ee/bushs https://beacons.ai/bushs https://bio.link/bushs"
    const urls = extractAggregatorUrls(bio)
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain("linktr.ee/bushs")
  })

  it("returns empty for null/plain bios", () => {
    expect(extractAggregatorUrls(null)).toEqual([])
    expect(extractAggregatorUrls("just chicken")).toEqual([])
  })
})
