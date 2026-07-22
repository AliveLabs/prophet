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
  detectSustainedMenuChange,
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
// A menu with specific item NAMES — content-based change detection keys on names, not counts.
function menuNamed(itemNames: string[]): MenuSnapshot {
  const items = itemNames.map((n) => item(10, n))
  return {
    menuUrl: null,
    capturedAt: "2026-06-19",
    screenshot: null,
    currency: "USD",
    categories: [{ name: "Menu", menuType: "dine_in", items }],
    parseMeta: { itemsTotal: items.length, confidence: "high", notes: [] },
  }
}
// n distinct item names, e.g. names(3) → ["d0","d1","d2"].
const names = (n: number, prefix = "d"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`)
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
    expect(priceFor(generateContentInsights(locMenu, compMenus, null, []))).toBeDefined()
  })
  it("without review corroboration, the play is positioning-framed (kills the Wagyu-$12.99 miss)", () => {
    const out = corroboratePriceInsights(generateContentInsights(locMenu, compMenus, null, []), null)
    const price = priceFor(out)
    expect(price?.evidence.corroboration).toBe("unknown")
    expect(price?.title.toLowerCase()).toContain("position on value")
  })
  it("with corroboration, the price play stands (strong)", () => {
    const pricedOut = reviews([{ theme: "price", sentiment: "negative", mentions: 6, examples: ["overpriced for what it is"] }])
    const out = corroboratePriceInsights(generateContentInsights(locMenu, compMenus, null, []), pricedOut)
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
    const out = generateContentInsights(locMenu, compMenus, null, [])
    expect(out.find((i) => i.insight_type === "menu.price_positioning_shift")).toBeUndefined()
  })
  it("menu.catering_pricing_gap: emits with a healthy sample, confidence reflects sample size (never a hardcoded literal)", () => {
    const locMenu: MenuSnapshot = { ...menu(90, "catering", 10), categories: [{ name: "Catering", menuType: "catering", items: Array.from({ length: 10 }, (_, i) => item(90 + i, `Tray ${i}`)) }] }
    const compMenu: MenuSnapshot = { ...menu(60, "catering", 10), categories: [{ name: "Catering", menuType: "catering", items: Array.from({ length: 10 }, (_, i) => item(60 + i, `Tray ${i}`)) }] }
    const compMenus = [{ competitorId: "c1", competitorName: "Rival", menu: compMenu, siteContent: null }]
    const out = generateContentInsights(locMenu, compMenus, null, [])
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
    const out = generateContentInsights(locMenu, compMenus, null, [])
    expect(out.find((i) => i.insight_type === "menu.catering_pricing_gap")).toBeUndefined()
  })
})

describe("generateContentInsights — menu-insight gate (ALT-363)", () => {
  const locMenu = menu(25) // 8 items → clears the coverage floor
  const compMenus = [{ competitorId: "c1", competitorName: "Rival", menu: menu(18), siteContent: null }]
  const menuOnly = (out: GeneratedInsight[]) => out.filter((i) => i.insight_type.startsWith("menu."))

  it("suppresses ALL menu.* insights when the flag is off (the default), leaving other rules untouched", () => {
    delete process.env.MENU_INSIGHTS
    expect(menuOnly(generateContentInsights(locMenu, compMenus, null, []))).toHaveLength(0)
    // sanity: the SAME inputs DO emit menu.* once the flag is on
    process.env.MENU_INSIGHTS = "1"
    expect(menuOnly(generateContentInsights(locMenu, compMenus, null, [])).length).toBeGreaterThan(0)
  })

  it("even with the flag on, suppresses menu.* when the location scrape is below the coverage floor (<5 items)", () => {
    const thinLoc = menu(25, "dine_in", 4)
    expect(menuOnly(generateContentInsights(thinLoc, compMenus, null, []))).toHaveLength(0)
  })

  it("emits menu.menu_change_detected only when the change has PERSISTED across scrapes", () => {
    const base = menuNamed(names(10)) // baseline S2
    const changed = menuNamed([...names(10), "special1", "special2", "special3"]) // +3, held S0≈S1
    const out = generateContentInsights(changed, compMenus, null, [changed, base])
    const chg = out.find((i) => i.insight_type === "menu.menu_change_detected")
    expect(chg).toBeDefined()
    expect(chg?.evidence.addedCount).toBe(3)
  })

  it("does NOT emit menu.menu_change_detected on a one-run blip (a thin scrape that didn't persist)", () => {
    const base = menuNamed(names(10))
    const blip = menuNamed(names(6)) // this run dropped 4 items, but prior run was the full 10
    const out = generateContentInsights(blip, compMenus, null, [base, base])
    expect(out.find((i) => i.insight_type === "menu.menu_change_detected")).toBeUndefined()
  })
})

describe("detectSustainedMenuChange (ALT-380) — content-based persistence, not count noise", () => {
  it("returns null without enough history to establish a baseline + one persisted prior", () => {
    const m = menuNamed(names(10))
    expect(detectSustainedMenuChange(m, [])).toBeNull()
    expect(detectSustainedMenuChange(m, [menuNamed(names(8))])).toBeNull() // only S1, no baseline S2
  })

  it("confirms a change only when the new item set held across the two latest scrapes", () => {
    const base = menuNamed(names(10))
    const added = [...names(10), "n1", "n2", "n3"]
    // S0 ≈ S1 (both the new state), differ from baseline S2 by +3 → confirmed
    const change = detectSustainedMenuChange(menuNamed(added), [menuNamed(added), base])
    expect(change).not.toBeNull()
    expect(change?.added.sort()).toEqual(["n1", "n2", "n3"])
    expect(change?.removed).toEqual([])
  })

  it("ignores a one-run blip: latest differs from BOTH recent scrapes (not persisted)", () => {
    const base = menuNamed(names(10))
    const blip = menuNamed(names(10).slice(0, 6)) // lost 4 this run only
    expect(detectSustainedMenuChange(blip, [base, base])).toBeNull()
  })

  it("ignores a drop-that-recovers: the bad scrape was the PRIOR run, not a real change", () => {
    const full = menuNamed(names(10))
    const badPrior = menuNamed(names(4)) // S1 was a failed thin read
    // S0 recovered to full; must NOT read as 'menu grew 6 items'
    expect(detectSustainedMenuChange(full, [badPrior, full])).toBeNull()
  })

  it("treats an anomalously thin latest read as a scrape failure, never a shrink", () => {
    const full = menuNamed(names(20))
    const thin = menuNamed(names(6)) // <50% of recent max (20) → failed read
    expect(detectSustainedMenuChange(thin, [full, full])).toBeNull()
  })

  it("absorbs minor scrape jitter (1-2 item wobble) without claiming a change", () => {
    const base = menuNamed(names(10))
    const jitterA = menuNamed([...names(10), "maybe1"]) // +1 vs baseline, within tolerance
    // S0 vs S1 differ by 1 (jitter), and the move vs baseline is only 1 item (< min 3) → null
    expect(detectSustainedMenuChange(jitterA, [base, base])).toBeNull()
  })
})
