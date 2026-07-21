// ALT-380 #4 — menu read stability.
// mergeExtractedMenus: item dedup is GLOBAL, so the same dish filed under two
// differently-named categories by two sources counts once (the ~149-for-82
// over-count). unionRecentMenus: a thin single run can't collapse the menu, and
// a padded/hallucinated run is dropped as an anomaly before unioning.

import { describe, it, expect } from "vitest"
import { mergeExtractedMenus, unionRecentMenus, type NormalizedMenuResult } from "@/lib/content/menu-parse"
import type { MenuCategory, MenuItem, MenuSnapshot } from "@/lib/content/types"

function mi(name: string, extra: Partial<MenuItem> = {}): MenuItem {
  return { name, description: null, price: null, priceValue: null, tags: [], ...extra }
}
function cat(name: string, items: MenuItem[]): MenuCategory {
  return { name, menuType: "dine_in", items }
}
function result(categories: MenuCategory[]): NormalizedMenuResult {
  return { categories, currency: "USD", confidence: "high", notes: [] }
}
function totalItems(categories: MenuCategory[]): number {
  return categories.reduce((s, c) => s + c.items.length, 0)
}
function snap(categories: MenuCategory[], capturedAt = "2026-07-20"): MenuSnapshot {
  const itemsTotal = totalItems(categories)
  return {
    menuUrl: "https://example.com/menu",
    capturedAt,
    screenshot: null,
    currency: "USD",
    categories,
    parseMeta: { itemsTotal, confidence: "high", notes: [], sources: ["firecrawl"] },
  }
}

describe("mergeExtractedMenus — global item dedup", () => {
  it("dedups the same dish filed under differently-named categories across sources", () => {
    const firecrawl = result([cat("Dinner", [mi("Brisket Plate"), mi("Ribs")])])
    const gemini = result([cat("Main Courses", [mi("Brisket Plate"), mi("Wings")])])

    const merged = mergeExtractedMenus([firecrawl, gemini])

    // Brisket once, plus Ribs and Wings — 3 unique, not 4.
    expect(totalItems(merged.categories)).toBe(3)
    const names = merged.categories.flatMap((c) => c.items.map((i) => i.name)).sort()
    expect(names).toEqual(["Brisket Plate", "Ribs", "Wings"])
  })

  it("keeps the richest occurrence of a duplicated item", () => {
    const thin = result([cat("Dinner", [mi("Brisket Plate")])])
    const rich = result([
      cat("Entrees", [mi("Brisket Plate", { price: "$24", priceValue: 24, description: "Slow smoked" })]),
    ])

    const merged = mergeExtractedMenus([thin, rich])
    const brisket = merged.categories.flatMap((c) => c.items).find((i) => i.name === "Brisket Plate")
    expect(brisket?.priceValue).toBe(24)
    expect(brisket?.description).toBe("Slow smoked")
  })

  it("preserves genuinely distinct items and drops emptied categories", () => {
    const a = result([cat("Dinner", [mi("Ribs"), mi("Brisket Plate")])])
    const b = result([cat("Dinner", [mi("Brisket Plate")]), cat("Drinks", [mi("Cola")])])
    const merged = mergeExtractedMenus([a, b])
    expect(totalItems(merged.categories)).toBe(3)
    expect(merged.categories.map((c) => c.name).sort()).toEqual(["Dinner", "Drinks"])
  })
})

describe("unionRecentMenus — cross-run stability", () => {
  it("holds the menu at the richer size when the latest run is thin", () => {
    const latestThin = snap([cat("Dinner", [mi("Burger")])], "2026-07-20")
    const priorRich = snap(
      [cat("Dinner", [mi("Burger"), mi("Fries"), mi("Shake"), mi("Salad"), mi("Wings")])],
      "2026-07-13"
    )
    const unioned = unionRecentMenus([latestThin, priorRich])
    expect(unioned).not.toBeNull()
    expect(unioned!.parseMeta.itemsTotal).toBe(5)
  })

  it("drops a high-outlier (padded/hallucinated) run before unioning", () => {
    const good1 = snap([cat("Dinner", Array.from({ length: 11 }, (_, i) => mi(`Dish ${i}`)))], "2026-07-20")
    const good2 = snap([cat("Dinner", Array.from({ length: 10 }, (_, i) => mi(`Dish ${i}`)))], "2026-07-13")
    // 41 items vs a ~11 median (cap 22) → clear outlier, dropped before unioning.
    const padded = snap(
      [cat("Dinner", [...Array.from({ length: 40 }, (_, i) => mi(`Dish ${i}`)), mi("Wagyu Hallucination Tower")])],
      "2026-06-29"
    )
    const unioned = unionRecentMenus([good1, good2, padded])
    const names = unioned!.categories.flatMap((c) => c.items.map((i) => i.name))
    expect(names).not.toContain("Wagyu Hallucination Tower")
    expect(unioned!.parseMeta.itemsTotal).toBe(11)
  })

  it("returns a single snapshot unchanged", () => {
    const only = snap([cat("Dinner", [mi("Burger"), mi("Fries")])])
    expect(unionRecentMenus([only])).toBe(only)
  })

  it("returns null when there are no usable snapshots", () => {
    expect(unionRecentMenus([])).toBeNull()
    expect(unionRecentMenus([null, undefined])).toBeNull()
  })
})
