// P4 — price corroboration. A lone "a competitor is cheaper" signal must NOT advise a
// premium spot to cut prices (the Wagyu-$12.99 miss). Only when the location's OWN reviews
// flag price does a price play stand; otherwise it reframes to positioning.

import { describe, it, expect } from "vitest"
import { generateContentInsights, canCorroboratePrice, corroboratePriceInsights } from "@/lib/content/insights"
import type { MenuItem, MenuSnapshot, MenuType } from "@/lib/content/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { ReviewSentiment } from "@/lib/insights/dossier/types"

// ── fixtures ───────────────────────────────────────────────────────────────
function item(priceValue: number, name = `Item ${priceValue}`): MenuItem {
  return { name, description: null, price: `$${priceValue}`, priceValue, tags: [] }
}
function menu(avg: number, menuType: MenuType = "dine_in"): MenuSnapshot {
  return {
    menuUrl: null,
    capturedAt: "2026-06-19",
    screenshot: null,
    currency: "USD",
    categories: [{ name: "Entrees", menuType, items: [item(avg, "Steak"), item(avg, "Chop")] }],
    parseMeta: { itemsTotal: 2, confidence: "high", notes: [] },
  }
}
function reviews(themes: ReviewSentiment["themes"]): ReviewSentiment {
  return { themes, source: "google_places", windowDays: 90 }
}
function priceShift(locAvg: number, compAvg: number): GeneratedInsight {
  return {
    insight_type: "menu.price_positioning_shift",
    title: "test",
    summary: "test",
    confidence: "high",
    severity: "info",
    evidence: {
      locationAvgPrice: locAvg,
      competitorAvgPrice: compAvg,
      priceDiffPct: Math.round((Math.abs(compAvg - locAvg) / locAvg) * 100),
      competitor: "Rival",
      menuType: "dine_in",
    },
    recommendations: [],
  }
}

describe("canCorroboratePrice", () => {
  it("true when a price/value theme is negative", () => {
    expect(canCorroboratePrice(reviews([{ theme: "value", sentiment: "negative", mentions: 4, examples: [] }]))).toBe(true)
  })
  it("true when an example quote mentions price (non-positive theme)", () => {
    expect(canCorroboratePrice(reviews([{ theme: "food", sentiment: "mixed", mentions: 2, examples: ["tasty but overpriced"] }]))).toBe(true)
  })
  it("false with no reviews / empty themes", () => {
    expect(canCorroboratePrice(null)).toBe(false)
    expect(canCorroboratePrice(reviews([]))).toBe(false)
  })
  it("false when value is praised (positive sentiment is the opposite of a price complaint)", () => {
    expect(canCorroboratePrice(reviews([{ theme: "great value", sentiment: "positive", mentions: 5, examples: ["worth every penny"] }]))).toBe(false)
  })
  it("false when the negative themes are not about price", () => {
    expect(canCorroboratePrice(reviews([{ theme: "service", sentiment: "negative", mentions: 3, examples: ["slow at the door"] }]))).toBe(false)
  })
  it("false when a non-price theme has a positively-toned price phrase in an example", () => {
    // negative SERVICE theme, but the price mention is positive — must NOT corroborate a price complaint
    expect(canCorroboratePrice(reviews([{ theme: "service", sentiment: "negative", mentions: 2, examples: ["slow but worth the wait, good value"] }]))).toBe(false)
  })
  it("false when a value theme is only 'mixed' with all-positive examples", () => {
    expect(canCorroboratePrice(reviews([{ theme: "value", sentiment: "mixed", mentions: 3, examples: ["great value", "worth every penny"] }]))).toBe(false)
  })
})

describe("corroboratePriceInsights", () => {
  const pricedOut = reviews([{ theme: "value", sentiment: "negative", mentions: 4, examples: ["way too expensive"] }])

  it("reviews ABSENT → reframe to positioning, stamped 'unknown' (no over-claim that guests are happy)", () => {
    const out = corroboratePriceInsights([priceShift(25, 18)], null)
    expect(out[0].insight_type).toBe("menu.price_positioning_mismatch")
    expect(out[0].evidence.corroboration).toBe("unknown")
    expect(out[0].confidence).toBe("medium")
    expect(out[0].title.toLowerCase()).toContain("position on value")
    expect(out[0].summary.toLowerCase()).toContain("not have enough reviews")
  })
  it("reviews PRESENT but quiet on price → reframe to positioning, stamped 'weak'", () => {
    const quiet = reviews([{ theme: "service", sentiment: "negative", mentions: 3, examples: ["slow at the door"] }])
    const out = corroboratePriceInsights([priceShift(25, 18)], quiet)
    expect(out[0].insight_type).toBe("menu.price_positioning_mismatch")
    expect(out[0].evidence.corroboration).toBe("weak")
    expect(out[0].title.toLowerCase()).toContain("aren't complaining")
  })
  it("keeps the shift and marks strong corroboration when reviews flag price", () => {
    const out = corroboratePriceInsights([priceShift(25, 18)], pricedOut)
    expect(out[0].insight_type).toBe("menu.price_positioning_shift")
    expect(out[0].evidence.corroboration).toBe("strong")
  })
  it("leaves the 'we're cheaper, room to raise' direction untouched", () => {
    const out = corroboratePriceInsights([priceShift(18, 25)], null) // our avg below competitor's
    expect(out[0].insight_type).toBe("menu.price_positioning_shift")
    expect(out[0].evidence.corroboration).toBeUndefined()
  })
  it("ignores non-price insights (same reference back)", () => {
    const other: GeneratedInsight = { insight_type: "menu.category_gap", title: "t", summary: "s", confidence: "medium", severity: "info", evidence: {}, recommendations: [] }
    expect(corroboratePriceInsights([other], null)[0]).toBe(other)
  })
})

describe("generateContentInsights price rule → corroboration (end to end)", () => {
  const locMenu = menu(25) // we are the premium one
  const compMenus = [{ competitorId: "c1", competitorName: "Rival", menu: menu(18), siteContent: null }]

  it("emits menu.price_positioning_shift on a >=15% gap", () => {
    const out = generateContentInsights(locMenu, compMenus, null, null)
    expect(out.some((i) => i.insight_type === "menu.price_positioning_shift")).toBe(true)
  })
  it("without review corroboration, the gap reframes to positioning (kills the Wagyu-$12.99 miss)", () => {
    const out = corroboratePriceInsights(generateContentInsights(locMenu, compMenus, null, null), null)
    expect(out.some((i) => i.insight_type === "menu.price_positioning_mismatch")).toBe(true)
    expect(out.some((i) => i.insight_type === "menu.price_positioning_shift")).toBe(false)
  })
  it("with corroboration, the price play stands", () => {
    const pricedOut = reviews([{ theme: "price", sentiment: "negative", mentions: 6, examples: ["overpriced for what it is"] }])
    const out = corroboratePriceInsights(generateContentInsights(locMenu, compMenus, null, null), pricedOut)
    const shift = out.find((i) => i.insight_type === "menu.price_positioning_shift")
    expect(shift?.evidence.corroboration).toBe("strong")
  })
})
