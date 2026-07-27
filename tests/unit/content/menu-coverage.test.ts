// ALT-380 / ALT-363 coverage guard. MIN_MENU_ITEMS_FOR_CLAIMS only catches near-EMPTY
// reads; the failure that made menu claims untrustworthy is the confidently-INCOMPLETE
// read (a 68-item menu scraped as 10 clears any item floor and looks fine to every other
// signal). menuCoverage() supplies the missing baseline, measured against the best read
// we've had for that same menu.
//
// Measured 2026-07-27 across 43 competitors: a single capture holds a median 60% of
// best-known, the 4-capture union holds 96% — but 14 of 43 stayed under 85% even unioned.
// These cases pin that the guard mutes that tail without muting new locations.

import { describe, it, expect } from "vitest"
import { menuCoverage, unionRecentMenus } from "@/lib/content/menu-parse"
import type { MenuSnapshot } from "@/lib/content/types"

describe("menuCoverage", () => {
  it("reports full coverage when the current read matches the best known", () => {
    expect(menuCoverage(60, [60, 58, 55])).toEqual({
      historicalHighItems: 60,
      coverageRatio: 1,
    })
  })

  it("flags a confidently-incomplete read (the 68→10 case)", () => {
    // Baseline is the SECOND-highest read (66), not the single best (68) — one lucky run
    // shouldn't set the bar on its own.
    const { coverageRatio, historicalHighItems } = menuCoverage(10, [68, 64, 60, 66])
    expect(historicalHighItems).toBe(66)
    expect(coverageRatio).toBeCloseTo(10 / 66, 3)
    expect(coverageRatio!).toBeLessThan(0.85)
  })

  it("keeps a legitimate cluster of larger reads when recent reads are degraded", () => {
    // The regression the median-cap approach had: mostly-thin history made the real menu
    // size look like an outlier, so a badly-degraded scrape scored as full coverage.
    const { historicalHighItems, coverageRatio } = menuCoverage(2, [2, 2, 2, 2, 6, 6])
    expect(historicalHighItems).toBe(6)
    expect(coverageRatio!).toBeLessThan(0.85)
  })

  it("withholds a verdict without enough history (new location must not be muted)", () => {
    expect(menuCoverage(12, [])).toEqual({})
    expect(menuCoverage(12, [12])).toEqual({})
  })

  it("ignores a hallucinated HIGH outlier so it can't permanently gate a real menu", () => {
    // One 300-item run against a steady ~60-item menu must not make 60 look like 20%.
    const { historicalHighItems, coverageRatio } = menuCoverage(60, [300, 60, 58, 62, 59])
    expect(historicalHighItems).toBe(62)
    expect(coverageRatio).toBeGreaterThan(0.9)
  })

  it("never exceeds 1 when the current read is the best ever", () => {
    const { coverageRatio, historicalHighItems } = menuCoverage(90, [70, 65, 68])
    expect(coverageRatio).toBe(1)
    expect(historicalHighItems).toBe(90)
  })

  it("skips zero/garbage counts rather than treating them as a baseline", () => {
    expect(menuCoverage(40, [0, 0, 40])).toEqual({})
  })
})

// Minimal snapshot factory. Items carry the full MenuItem shape because the merge path
// scores item richness (price/description/tags) when deduping.
function snap(items: number, names: string[]): MenuSnapshot {
  return {
    menuUrl: "https://example.com/menu",
    capturedAt: "2026-07-20T00:00:00.000Z",
    screenshot: null,
    currency: "USD",
    categories: [
      {
        name: "Mains",
        menuType: "dine_in",
        items: names.map((n) => ({
          name: n,
          description: null,
          price: "$10.00",
          priceValue: 10,
          tags: [],
        })),
      },
    ],
    parseMeta: { itemsTotal: items, confidence: "medium", notes: [], sources: ["firecrawl"] },
  } as MenuSnapshot
}

describe("unionRecentMenus stamps coverage onto parseMeta", () => {
  it("computes coverage from the FULL history, not just the unioned window", () => {
    // Newest 4 are thin; older captures prove the menu is really ~6 items.
    const snaps = [
      snap(2, ["Burger", "Fries"]),
      snap(2, ["Burger", "Fries"]),
      snap(2, ["Burger", "Fries"]),
      snap(2, ["Burger", "Fries"]),
      snap(6, ["Burger", "Fries", "Shake", "Salad", "Wings", "Pie"]),
      snap(6, ["Burger", "Fries", "Shake", "Salad", "Wings", "Pie"]),
    ]
    const out = unionRecentMenus(snaps, 4)
    expect(out).not.toBeNull()
    expect(out!.parseMeta.historicalHighItems).toBe(6)
    expect(out!.parseMeta.coverageRatio!).toBeLessThan(0.85)
  })

  it("still stamps coverage when only one capture is in the union window", () => {
    // history [30,31,29] → second-highest baseline is 30, and the single read IS 30.
    const out = unionRecentMenus([snap(30, ["a"]), snap(31, ["b"]), snap(29, ["c"])], 1)
    expect(out!.parseMeta.historicalHighItems).toBe(30)
    expect(out!.parseMeta.coverageRatio).toBe(1)
  })

  it("returns null when there is nothing usable", () => {
    expect(unionRecentMenus([null, undefined])).toBeNull()
  })
})
