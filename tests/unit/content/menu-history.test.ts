import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fromRows } from "@/lib/content/menu-history"
import type { MenuSnapshot } from "@/lib/content/types"

// ALT-363. The dossier read the single latest RAW menu capture while the three pipelines all
// unioned. The raw scrape is genuinely unstable, so a thin read became ground truth for every
// producer skill.
//
// Fixture numbers are REAL, measured in prod 2026-08-20 across repeat captures of unchanged menus:
//   20 captures:  3 to 110 items  (36.7x)
//   20 captures:  3 to  89 items  (29.7x)
//   31 captures:  4 to  72 items  (18.0x)
//   22 captures: 16 to 169 items  (10.6x)

/** A capture with `n` distinctly-named items, so a union actually accumulates them. */
function capture(n: number, dateKey: string, offset = 0): { raw_data: MenuSnapshot; date_key: string } {
  return {
    date_key: dateKey,
    raw_data: {
      menuUrl: "https://example.com/menu",
      currency: "USD",
      capturedAt: `${dateKey}T00:00:00Z`,
      categories: [
        {
          name: "Menu",
          // `tags` and `description` are present because real snapshots carry them and
          // itemRichness reads tags.length when merging. A fixture that omits them passes the
          // single-capture path and throws on the merge path, which is the wrong half to exercise.
          items: Array.from({ length: n }, (_, i) => ({
            name: `item-${offset + i}`,
            price: 10,
            description: null,
            tags: [],
          })),
        },
      ],
      parseMeta: { itemsTotal: n, confidence: "high" as const },
    } as unknown as MenuSnapshot,
  }
}

describe("fromRows: the union is what consumers reason over", () => {
  it("a thin latest capture does NOT become the menu", () => {
    // The exact failure. Newest read is 3 items; history proves the menu is much bigger.
    const rows = [capture(3, "2026-08-16"), capture(110, "2026-08-09", 100), capture(98, "2026-08-02", 300)]
    const read = fromRows(rows)
    const unionItems = read.menu!.categories.reduce((s, c) => s + c.items.length, 0)

    expect(read.history[0].parseMeta.itemsTotal).toBe(3) // raw latest is still 3
    expect(unionItems).toBeGreaterThan(3) // but the menu we reason over is not
    expect(unionItems).toBeGreaterThan(100)
  })

  it("freshness comes from the newest RAW capture, because unioning is not a re-read", () => {
    const read = fromRows([capture(3, "2026-08-16"), capture(110, "2026-08-09", 100)])
    expect(read.dateKey).toBe("2026-08-16")
  })

  it("keeps the raw history, which the sustained-change detector needs unsmoothed", () => {
    const read = fromRows([capture(3, "2026-08-16"), capture(110, "2026-08-09", 100)])
    expect(read.history).toHaveLength(2)
    expect(read.history.map((h) => h.parseMeta.itemsTotal)).toEqual([3, 110])
  })

  it("does NOT launder a genuinely small menu into a big one", () => {
    // Every capture agrees the menu is small. The union must not invent items.
    const rows = [capture(6, "2026-08-16"), capture(6, "2026-08-09"), capture(6, "2026-08-02")]
    const items = fromRows(rows).menu!.categories.reduce((s, c) => s + c.items.length, 0)
    expect(items).toBe(6)
  })

  it("a brand-new location with ONE capture passes through untouched", () => {
    // Absence of history must not read as evidence of a bad scrape.
    const read = fromRows([capture(40, "2026-08-16")])
    expect(read.menu!.categories.reduce((s, c) => s + c.items.length, 0)).toBe(40)
    expect(read.history).toHaveLength(1)
  })

  it("empty and junk input fail soft rather than throwing", () => {
    for (const input of [null, undefined, []]) {
      const read = fromRows(input)
      expect(read.menu).toBeNull()
      expect(read.dateKey).toBeNull()
      expect(read.history).toEqual([])
    }
    // A row whose raw_data is not a menu is dropped, not crashed on.
    expect(fromRows([{ raw_data: null }, { raw_data: { nope: true } }]).menu).toBeNull()
  })
})

describe("source guard: the dossier must not reintroduce its own menu query", () => {
  // This is the regression that actually happened: four call sites each had their own copy of the
  // snapshot query, and the dossier's copy drifted to reading the raw latest. A source assertion
  // is the cheapest thing that catches a fifth copy.
  // Comments are stripped before asserting, because the file legitimately NAMES the old provider
  // strings when explaining what was removed. Asserting against raw source would make the guard
  // fail on its own documentation, which is how a useful guard gets deleted.
  const dossier = readFileSync("lib/insights/dossier/build.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")

  it("the dossier loads menus through the shared loader", () => {
    expect(dossier).toContain("loadLocationMenu")
    expect(dossier).toContain("loadCompetitorMenu")
  })

  it("the dossier no longer reads firecrawl_menu directly", () => {
    // If this fails, someone re-added a private menu query. Use the loader instead.
    expect(dossier).not.toContain('"firecrawl_menu"')
  })

  it("the dossier no longer reads web_menu_weekly directly", () => {
    expect(dossier).not.toContain('"web_menu_weekly"')
  })
})
