// P4 — price corroboration. A lone "a competitor is cheaper" signal must NOT advise a
// premium spot to cut prices (the Wagyu-$12.99 miss). Only when the location's OWN reviews
// flag price does a price play stand; otherwise it reframes to positioning.

import { describe, it, expect, beforeEach, afterAll } from "vitest"
import {
  generateContentInsights,
  canCorroboratePrice,
  corroboratePriceInsights,
  comparableItems,
  priceStatsPair,
} from "@/lib/content/insights"
import type { MenuItem, MenuCategory, MenuSnapshot, MenuType } from "@/lib/content/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { ReviewSentiment } from "@/lib/insights/dossier/types"

// ── fixtures ───────────────────────────────────────────────────────────────
function item(priceValue: number, name = `Item ${priceValue}`): MenuItem {
  return { name, description: null, price: `$${priceValue}`, priceValue, tags: [] }
}
// `count` identical-priced items — keeps avg == avg exactly while clearing the minimum-
// comparable-sample gate (MIN_COMPARABLE_ITEMS=6 in lib/content/insights.ts). Default 8
// sits in the "medium" confidence band (6-11); pass 12+ to test the "high" band.
function menu(avg: number, menuType: MenuType = "dine_in", count = 8): MenuSnapshot {
  const items = Array.from({ length: count }, (_, i) => item(avg, `Entree ${i}`))
  return {
    menuUrl: null,
    capturedAt: "2026-06-19",
    screenshot: null,
    currency: "USD",
    categories: [{ name: "Entrees", menuType, items }],
    parseMeta: { itemsTotal: count, confidence: "high", notes: [] },
  }
}
function categoriesOf(items: MenuItem[], menuType: MenuType = "dine_in"): MenuCategory[] {
  return [{ name: "Entrees", menuType, items }]
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

// The menu-insight gate (ALT-363) defaults OFF (opt-in via MENU_INSIGHTS=1). Every test
// below that asserts menu.* EMISSION needs the flag on; enable it per test and restore the
// original afterward. The gate's own suppression behavior is exercised in its own block,
// which overrides the flag inside individual tests.
const ORIGINAL_MENU_FLAG = process.env.MENU_INSIGHTS
beforeEach(() => {
  process.env.MENU_INSIGHTS = "1"
})
afterAll(() => {
  if (ORIGINAL_MENU_FLAG === undefined) delete process.env.MENU_INSIGHTS
  else process.env.MENU_INSIGHTS = ORIGINAL_MENU_FLAG
})

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
  // The insight_type NEVER changes (one price type, avoids retention-window duplicates); the
  // verdict rides on evidence.corroboration. Framing is derived from the verdict + evidence.

  it("reviews ABSENT → positioning framing stamped 'unknown' (no over-claim that guests are happy)", () => {
    const out = corroboratePriceInsights([priceShift(25, 18)], null)
    expect(out[0].insight_type).toBe("menu.price_positioning_shift")
    expect(out[0].evidence.corroboration).toBe("unknown")
    expect(out[0].confidence).toBe("medium")
    expect(out[0].title.toLowerCase()).toContain("position on value")
    expect(out[0].summary.toLowerCase()).toContain("not have enough reviews")
  })
  it("reviews PRESENT but quiet on price → positioning framing stamped 'weak'", () => {
    const quiet = reviews([{ theme: "service", sentiment: "negative", mentions: 3, examples: ["slow at the door"] }])
    const out = corroboratePriceInsights([priceShift(25, 18)], quiet)
    expect(out[0].insight_type).toBe("menu.price_positioning_shift")
    expect(out[0].evidence.corroboration).toBe("weak")
    expect(out[0].title.toLowerCase()).toContain("aren't complaining")
  })
  it("reviews flag price → price-action framing stamped 'strong', confidence high", () => {
    const out = corroboratePriceInsights([priceShift(25, 18)], pricedOut)
    expect(out[0].insight_type).toBe("menu.price_positioning_shift")
    expect(out[0].evidence.corroboration).toBe("strong")
    expect(out[0].confidence).toBe("high")
    expect(out[0].title.toLowerCase()).toContain("flagging")
  })
  it("leaves the 'we're cheaper, room to raise' direction untouched", () => {
    const out = corroboratePriceInsights([priceShift(18, 25)], null) // our avg below competitor's
    expect(out[0].evidence.corroboration).toBeUndefined()
  })
  it("ignores non-price insights (same reference back)", () => {
    const other: GeneratedInsight = { insight_type: "menu.category_gap", title: "t", summary: "s", confidence: "medium", severity: "info", evidence: {}, recommendations: [] }
    expect(corroboratePriceInsights([other], null)[0]).toBe(other)
  })
  it("is IDEMPOTENT: re-running on an already-corroborated row is stable", () => {
    const once = corroboratePriceInsights([priceShift(25, 18)], null)
    const twice = corroboratePriceInsights(once, null)
    expect(twice[0].title).toBe(once[0].title)
    expect(twice[0].evidence.corroboration).toBe("unknown")
  })
  it("re-running a previously-weak row with NEW corroborating reviews flips it to strong framing", () => {
    const weak = corroboratePriceInsights([priceShift(25, 18)], null) // unknown/positioning content
    const reflowed = corroboratePriceInsights(weak, pricedOut) // reviews now flag price
    expect(reflowed[0].evidence.corroboration).toBe("strong")
    expect(reflowed[0].title.toLowerCase()).toContain("flagging") // content regenerated, not stale
  })
})

describe("generateContentInsights price rule → corroboration (end to end)", () => {
  const locMenu = menu(25) // we are the premium one
  const compMenus = [{ competitorId: "c1", competitorName: "Rival", menu: menu(18), siteContent: null }]
  const priceFor = (out: GeneratedInsight[]) => out.find((i) => i.insight_type === "menu.price_positioning_shift")

  it("emits menu.price_positioning_shift on a >=15% gap", () => {
    expect(priceFor(generateContentInsights(locMenu, compMenus, null, null))).toBeDefined()
  })
  it("without review corroboration, the play is positioning-framed (kills the Wagyu-$12.99 miss)", () => {
    const out = corroboratePriceInsights(generateContentInsights(locMenu, compMenus, null, null), null)
    const price = priceFor(out)
    expect(price?.evidence.corroboration).toBe("unknown")
    expect(price?.title.toLowerCase()).toContain("position on value")
  })
  it("with corroboration, the price play stands (strong)", () => {
    const pricedOut = reviews([{ theme: "price", sentiment: "negative", mentions: 6, examples: ["overpriced for what it is"] }])
    const out = corroboratePriceInsights(generateContentInsights(locMenu, compMenus, null, null), pricedOut)
    expect(priceFor(out)?.evidence.corroboration).toBe("strong")
  })
})

// ── Data-integrity fix (2026-07-01): a flat average of every priced item compared a
// combo-driven concept (Raising Cane's) against à-la-carte concepts (Whataburger, Arby's,
// Chick-fil-A) and swung wildly run-to-run on a live account because the comparable sample
// was as thin as 3-5 items. See lib/content/insights.ts comparableItems/priceStatsPair. ──

describe("comparableItems — excludes standalone non-meal add-ons, with a fallback", () => {
  it("drops drinks/sides/sauces/desserts sold on their own", () => {
    const cats = categoriesOf([
      item(12, "Grilled Chicken Sandwich"),
      item(11, "Cheeseburger"),
      item(2.5, "Fountain Drink"),
      item(1.5, "BBQ Sauce"),
      item(3, "Small Side"),
      item(4, "Cookie"),
    ])
    expect(comparableItems(cats).sort((a, b) => a - b)).toEqual([11, 12])
  })
  it("keeps an item whose NAME doesn't match the non-meal pattern even in a small menu", () => {
    const cats = categoriesOf([item(9, "Club Sandwich"), item(10, "Grilled Cheese")])
    expect(comparableItems(cats).sort((a, b) => a - b)).toEqual([9, 10])
  })
  it("falls back to the unfiltered set when filtering would empty it (an all-sides/drinks menu)", () => {
    const cats = categoriesOf([item(2, "Iced Tea"), item(3, "French Fries"), item(1, "Ketchup")])
    expect(comparableItems(cats).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
})

describe("priceStatsPair — minimum-sample gate + confidence tiers", () => {
  it("returns null (drop the insight) when EITHER side has fewer than 6 comparable items", () => {
    const thin = categoriesOf(Array.from({ length: 3 }, (_, i) => item(10 + i, `Entree ${i}`)))
    const healthy = categoriesOf(Array.from({ length: 8 }, (_, i) => item(10 + i, `Entree ${i}`)))
    expect(priceStatsPair(thin, healthy)).toBeNull()
    expect(priceStatsPair(healthy, thin)).toBeNull()
  })
  it("confidence is 'medium' when the smaller side has 6-11 comparable items", () => {
    const eight = categoriesOf(Array.from({ length: 8 }, () => item(10)))
    const twenty = categoriesOf(Array.from({ length: 20 }, () => item(12)))
    const stats = priceStatsPair(eight, twenty)
    expect(stats?.loc.confidence).toBe("medium")
    expect(stats?.comp.confidence).toBe("medium") // confidence reflects the SMALLER side for both
  })
  it("confidence is 'high' only when the smaller side has >=12 comparable items", () => {
    const twelve = categoriesOf(Array.from({ length: 12 }, () => item(10)))
    const twenty = categoriesOf(Array.from({ length: 20 }, () => item(12)))
    const stats = priceStatsPair(twelve, twenty)
    expect(stats?.loc.confidence).toBe("high")
  })
  it("reproduces the live Whataburger instability finding: a 3-5 item catering sample never clears the gate", () => {
    const caneCatering = categoriesOf([item(95.99, "Family Pack"), item(89.99, "Party Box")], "catering")
    const wbCateringDay1 = categoriesOf(
      [item(65.32, "Bag Meal"), item(58.0, "Party Pack"), item(72.65, "Big Box")],
      "catering",
    )
    expect(priceStatsPair(caneCatering, wbCateringDay1)).toBeNull()
  })
})

describe("generateContentInsights — thin/unstable samples are dropped, not reported", () => {
  it("does NOT emit menu.price_positioning_shift when the comparable sample is below the minimum (was: always emitted at hardcoded 'high' confidence)", () => {
    const locMenu = menu(25, "dine_in", 2) // the old fixture size — exactly what broke on live data
    const compMenus = [{ competitorId: "c1", competitorName: "Rival", menu: menu(18, "dine_in", 2), siteContent: null }]
    const out = generateContentInsights(locMenu, compMenus, null, null)
    expect(out.find((i) => i.insight_type === "menu.price_positioning_shift")).toBeUndefined()
  })
  it("menu.catering_pricing_gap: emits with a healthy sample, confidence reflects sample size (never a hardcoded literal)", () => {
    const locMenu: MenuSnapshot = { ...menu(90, "catering", 10), categories: [{ name: "Catering", menuType: "catering", items: Array.from({ length: 10 }, (_, i) => item(90 + i, `Tray ${i}`)) }] }
    const compMenu: MenuSnapshot = { ...menu(60, "catering", 10), categories: [{ name: "Catering", menuType: "catering", items: Array.from({ length: 10 }, (_, i) => item(60 + i, `Tray ${i}`)) }] }
    const compMenus = [{ competitorId: "c1", competitorName: "Rival", menu: compMenu, siteContent: null }]
    const out = generateContentInsights(locMenu, compMenus, null, null)
    const gap = out.find((i) => i.insight_type === "menu.catering_pricing_gap")
    expect(gap).toBeDefined()
    expect(gap?.confidence).toBe("medium") // 10 items/side → medium band, not a hardcoded "high"
    expect(gap?.evidence.locationSampleSize).toBe(10)
    expect(gap?.evidence.competitorSampleSize).toBe(10)
  })
  it("menu.catering_pricing_gap: does NOT emit on a thin sample (the exact live-data failure mode — a 3-item catering bucket)", () => {
    const locMenu: MenuSnapshot = { ...menu(95.99, "catering", 2), categories: [{ name: "Catering", menuType: "catering", items: [item(95.99, "Family Pack"), item(89.99, "Party Box")] }] }
    const compMenu: MenuSnapshot = { ...menu(65, "catering", 3), categories: [{ name: "Catering", menuType: "catering", items: [item(65.32, "Bag Meal"), item(58, "Party Pack"), item(72.65, "Big Box")] }] }
    const compMenus = [{ competitorId: "c1", competitorName: "Rival", menu: compMenu, siteContent: null }]
    const out = generateContentInsights(locMenu, compMenus, null, null)
    expect(out.find((i) => i.insight_type === "menu.catering_pricing_gap")).toBeUndefined()
  })
})

describe("generateContentInsights — menu-insight gate (ALT-363)", () => {
  const locMenu = menu(25) // 8 items → clears the coverage floor
  const compMenus = [{ competitorId: "c1", competitorName: "Rival", menu: menu(18), siteContent: null }]
  const menuOnly = (out: GeneratedInsight[]) => out.filter((i) => i.insight_type.startsWith("menu."))

  it("suppresses ALL menu.* insights when the flag is off (the default), leaving other rules untouched", () => {
    delete process.env.MENU_INSIGHTS
    expect(menuOnly(generateContentInsights(locMenu, compMenus, null, null))).toHaveLength(0)
    // sanity: the SAME inputs DO emit menu.* once the flag is on
    process.env.MENU_INSIGHTS = "1"
    expect(menuOnly(generateContentInsights(locMenu, compMenus, null, null)).length).toBeGreaterThan(0)
  })

  it("even with the flag on, suppresses menu.* when the location scrape is below the coverage floor (<5 items)", () => {
    const thinLoc = menu(25, "dine_in", 4)
    expect(menuOnly(generateContentInsights(thinLoc, compMenus, null, null))).toHaveLength(0)
  })

  it("drops menu.menu_change_detected on a >40% run-to-run swing (scrape artifact, not a real change)", () => {
    const current = menu(20, "dine_in", 10)
    const previous = menu(20, "dine_in", 30) // 67% drop ⇒ artifact
    const out = generateContentInsights(current, compMenus, null, previous)
    expect(out.find((i) => i.insight_type === "menu.menu_change_detected")).toBeUndefined()
  })

  it("keeps menu.menu_change_detected on a within-band change (a real menu change)", () => {
    const current = menu(20, "dine_in", 10)
    const previous = menu(20, "dine_in", 14) // delta 4 (fires) + 29% swing (< 40%) ⇒ real
    const out = generateContentInsights(current, compMenus, null, previous)
    expect(out.find((i) => i.insight_type === "menu.menu_change_detected")).toBeDefined()
  })
})
