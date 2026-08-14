// Menu reliability: the dossier must reason over the UNIONED menu, a degraded read must be
// identifiable as degraded, and confidence must never claim "high" without coverage behind it.
//
// The fixture is real production data (read 2026-08-14). One location's 21 weekly captures of
// the same unchanged menu returned 12, 30, 49, 49, 54, 62, 69, 70, 71, 81, 81, 89, 96, 98, 104,
// 112, 135, 137, 147, 149, 169 items. On 2026-07-12 the scrape read 12. Every one of those 21
// snapshots stored confidence "high" and none stored a coverage ratio, so on that Sunday the
// dossier handed every producer skill a 12-item menu labelled as a confident read.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import { loadUnionedLocationMenu, loadPriorMenuItemCounts } from "@/lib/content/menu-history"
import { deriveMenuConfidence, stampMenuCoverage, MENU_MIN_COVERAGE_RATIO } from "@/lib/content/menu-parse"
import { generateContentInsights } from "@/lib/content/insights"
import type { MenuSnapshot } from "@/lib/content/types"

// The 12 most recent captures as of the 12-item read, newest-first: exactly what
// MENU_HISTORY_WINDOW would have loaded that day.
const SUGARBACON_WINDOW = [12, 30, 98, 81, 112, 89, 54, 62, 71, 49, 49, 96]

/** A capture of `count` items, named item-1..item-count, so a bigger read is a superset of a
 *  smaller one (what unioning across runs of the same unchanged menu actually looks like). */
function capture(count: number, dateKey: string, priceValue = 12): { raw_data: MenuSnapshot; date_key: string } {
  return {
    date_key: dateKey,
    raw_data: {
      menuUrl: "https://example.com/menu",
      capturedAt: `${dateKey}T12:00:00.000Z`,
      screenshot: null,
      currency: "USD",
      categories: [
        {
          name: "Menu",
          menuType: "dine_in",
          items: Array.from({ length: count }, (_, i) => ({
            name: `item-${i + 1}`,
            description: null,
            price: `$${priceValue}.00`,
            priceValue,
            tags: [],
          })),
        },
      ],
      // The stored shape this whole ticket is about: item-count "high", no coverage.
      parseMeta: { itemsTotal: count, confidence: "high", notes: [], sources: ["firecrawl"] },
    },
  }
}

function windowRows(counts: number[]) {
  // Descending date keys, newest first, matching the loader's ordering.
  return counts.map((n, i) => capture(n, `2026-07-${String(28 - i).padStart(2, "0")}`))
}

/** Client whose menu-history query resolves to `rows` (the projection shape). */
function countsClient(rows: Array<{ items: string }>) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn().mockReturnValue({ limit })
  const eqType = vi.fn().mockReturnValue({ order })
  const eqEntity = vi.fn().mockReturnValue({ eq: eqType })
  const select = vi.fn().mockReturnValue({ eq: eqEntity })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { from } as unknown as SupabaseClient, from, select, order, limit }
}

function fakeClient(rows: ReturnType<typeof windowRows>) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn().mockReturnValue({ limit })
  const eqProvider = vi.fn().mockReturnValue({ order })
  const eqEntity = vi.fn().mockReturnValue({ eq: eqProvider })
  const select = vi.fn().mockReturnValue({ eq: eqEntity })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { from } as unknown as SupabaseClient, from, select, order, limit }
}

describe("the dossier reads the union, not the latest raw capture", () => {
  it("returns the unioned menu while the raw latest read stays 12 items", async () => {
    const { client, from, order, limit } = fakeClient(windowRows(SUGARBACON_WINDOW))

    const { menu, history, latestDateKey } = await loadUnionedLocationMenu(client, "loc-1")

    expect(from).toHaveBeenCalledWith("location_snapshots")
    expect(order).toHaveBeenCalledWith("date_key", { ascending: false })
    expect(limit).toHaveBeenCalledWith(12) // MENU_HISTORY_WINDOW

    // What the raw path used to hand the producers.
    expect(history[0].parseMeta.itemsTotal).toBe(12)
    // What they get now: the union of the recent window (12 ∪ 30 ∪ 98 ∪ 81 = 98 items).
    expect(menu!.parseMeta.itemsTotal).toBe(98)
    expect(menu!.parseMeta.itemsTotal).toBeGreaterThan(history[0].parseMeta.itemsTotal)
    // Freshness still reports the newest RAW capture: unioning is not a claim that we looked
    // again, only that we stopped believing one bad look.
    expect(latestDateKey).toBe("2026-07-28")
  })

  it("stamps the union with a coverage verdict the producers can see", async () => {
    const { client } = fakeClient(windowRows(SUGARBACON_WINDOW))
    const { menu } = await loadUnionedLocationMenu(client, "loc-1")

    // Second-highest of the window is 98; the union recovered it.
    expect(menu!.parseMeta.historicalHighItems).toBe(98)
    expect(menu!.parseMeta.coverageRatio).toBe(1)
    expect(menu!.parseMeta.confidence).toBe("high")
  })

  it("does NOT whitewash a run of bad captures: a still-thin union stays low coverage", async () => {
    // Constructed from the same location's real numbers, with four thin Sundays in a row.
    // Unioning is a defense, not a laundering step: if the recent window genuinely never saw
    // the menu, the union must say so rather than inherit the old "high".
    const { client } = fakeClient(windowRows([12, 30, 12, 30, 112, 89, 54, 62, 71, 49, 49, 96]))
    const { menu } = await loadUnionedLocationMenu(client, "loc-1")

    expect(menu!.parseMeta.itemsTotal).toBe(30)
    expect(menu!.parseMeta.historicalHighItems).toBe(96)
    expect(menu!.parseMeta.coverageRatio!).toBeLessThan(MENU_MIN_COVERAGE_RATIO)
    expect(menu!.parseMeta.confidence).toBe("low")
  })

  it("reports an empty history (not a fabricated menu) when the read fails", async () => {
    const limit = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } })
    const order = vi.fn().mockReturnValue({ limit })
    const eqProvider = vi.fn().mockReturnValue({ order })
    const eqEntity = vi.fn().mockReturnValue({ eq: eqProvider })
    const select = vi.fn().mockReturnValue({ eq: eqEntity })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    const { menu, history, latestDateKey } = await loadUnionedLocationMenu(client, "loc-1")
    expect(menu).toBeNull()
    expect(history).toEqual([])
    expect(latestDateKey).toBeNull()
  })

  it("buildDossier's own-menu read goes through the union loader (source guard)", () => {
    // The regression this whole change exists to prevent: buildDossier had its own copy of
    // the snapshot query and quietly diverged from the pipelines that already unioned.
    const source = readFileSync(
      path.join(process.cwd(), "lib/insights/dossier/build.ts"),
      "utf8",
    )
    expect(source).toContain("loadUnionedLocationMenu(sb, locationId)")
    expect(source).not.toContain('latestSnapshotMeta(sb, locationId, "firecrawl_menu")')
  })
})

describe("a degraded read is identifiable at write time", () => {
  it("stamps the 12-item read as low coverage against its own history", () => {
    const [, ...priorCounts] = SUGARBACON_WINDOW
    const raw = capture(12, "2026-07-12").raw_data
    const stamped = stampMenuCoverage(raw, priorCounts)

    expect(stamped.parseMeta.historicalHighItems).toBe(98)
    expect(stamped.parseMeta.coverageRatio!).toBeCloseTo(12 / 98, 3)
    expect(stamped.parseMeta.coverageRatio!).toBeLessThan(MENU_MIN_COVERAGE_RATIO)
    // The stored verdict flips from the item-count "high" it used to carry.
    expect(raw.parseMeta.confidence).toBe("high")
    expect(stamped.parseMeta.confidence).toBe("low")
    // Storage stays the RAW per-run read: only parseMeta gains the verdict.
    expect(stamped.parseMeta.itemsTotal).toBe(12)
    expect(stamped.categories).toBe(raw.categories)
  })

  it("stamps a healthy read as high coverage", () => {
    const stamped = stampMenuCoverage(capture(137, "2026-08-09").raw_data, SUGARBACON_WINDOW.slice(1))
    expect(stamped.parseMeta.coverageRatio).toBe(1)
    expect(stamped.parseMeta.confidence).toBe("high")
  })

  it("withholds a verdict (unknown, never high) for a target with no history", () => {
    const stamped = stampMenuCoverage(capture(40, "2026-08-09").raw_data, [])
    expect(stamped.parseMeta.coverageRatio).toBeUndefined()
    expect(stamped.parseMeta.historicalHighItems).toBeUndefined()
    expect(stamped.parseMeta.confidence).toBe("unknown")
  })

  it("counts prior reads for a competitor from the competitor snapshot table", async () => {
    // The jsonb projection returns the count as a string under `items`.
    const { client, from, limit } = countsClient([{ items: "58" }, { items: "41" }, { items: "25" }])
    const counts = await loadPriorMenuItemCounts(client, { competitorId: "comp-1" })
    expect(from).toHaveBeenCalledWith("snapshots")
    expect(limit).toHaveBeenCalledWith(12)
    expect(counts).toEqual([58, 41, 25])
  })

  it("re-reads the rows whole when the jsonb projection is rejected", async () => {
    // Losing coverage stamping because of a PostgREST select quirk would silently put every
    // menu back to "unknown", so the projection failing must not be the end of the attempt.
    const rows = windowRows([58, 41])
    const results = [
      { data: null, error: { message: "unsupported select" } },
      { data: rows, error: null },
    ]
    const limit = vi.fn().mockImplementation(() => Promise.resolve(results.shift()))
    const order = vi.fn().mockReturnValue({ limit })
    const eqProvider = vi.fn().mockReturnValue({ order })
    const eqEntity = vi.fn().mockReturnValue({ eq: eqProvider })
    const select = vi.fn().mockReturnValue({ eq: eqEntity })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    expect(await loadPriorMenuItemCounts(client, { locationId: "loc-1" })).toEqual([58, 41])
    expect(select).toHaveBeenNthCalledWith(1, "items:raw_data->parseMeta->>itemsTotal")
    expect(select).toHaveBeenNthCalledWith(2, "raw_data")
  })

  it("returns no counts (never a fabricated baseline) when both reads fail", async () => {
    const limit = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } })
    const order = vi.fn().mockReturnValue({ limit })
    const eqProvider = vi.fn().mockReturnValue({ order })
    const eqEntity = vi.fn().mockReturnValue({ eq: eqProvider })
    const select = vi.fn().mockReturnValue({ eq: eqEntity })
    const client = { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient

    expect(await loadPriorMenuItemCounts(client, { locationId: "loc-1" })).toEqual([])
  })
})

describe("confidence is derived from coverage, and absence reads as unknown", () => {
  it("maps a coverage ratio to a read-quality verdict", () => {
    expect(deriveMenuConfidence(1)).toBe("high")
    expect(deriveMenuConfidence(0.85)).toBe("high")
    expect(deriveMenuConfidence(0.84)).toBe("medium")
    expect(deriveMenuConfidence(0.5)).toBe("medium")
    expect(deriveMenuConfidence(12 / 98)).toBe("low")
  })

  it("never returns 'high' without a verdict", () => {
    expect(deriveMenuConfidence(undefined)).toBe("unknown")
    expect(deriveMenuConfidence(Number.NaN)).toBe("unknown")
  })
})

describe("menu claims stay gated on a degraded read", () => {
  const ORIGINAL_FLAG = process.env.MENU_INSIGHTS
  beforeEach(() => {
    process.env.MENU_INSIGHTS = "1"
  })
  afterAll(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.MENU_INSIGHTS
    else process.env.MENU_INSIGHTS = ORIGINAL_FLAG
  })

  // A cheaper rival, so the price rules have something real to say when the gate lets them.
  const rival = () => ({
    competitorId: "c1",
    competitorName: "Rival",
    menu: capture(10, "2026-07-12", 18).raw_data,
    siteContent: null,
  })
  const menuClaims = (locMenu: MenuSnapshot) =>
    generateContentInsights(locMenu, [rival()], null, []).filter((i) => i.insight_type.startsWith("menu."))

  it("suppresses menu.* on a 12-item read of a menu known to be ~98 items", () => {
    // 12 items clears MIN_MENU_ITEMS_FOR_CLAIMS (5) easily. Only the coverage verdict knows
    // this read is wrong, which is precisely why it has to be stamped and carried.
    const degraded = stampMenuCoverage(capture(12, "2026-07-12", 25).raw_data, SUGARBACON_WINDOW.slice(1))
    expect(degraded.parseMeta.itemsTotal).toBe(12)
    expect(menuClaims(degraded)).toHaveLength(0)
  })

  it("still emits menu.* on a healthy read of the same menu", () => {
    const healthy = stampMenuCoverage(capture(98, "2026-08-09", 25).raw_data, SUGARBACON_WINDOW.slice(1))
    expect(healthy.parseMeta.confidence).toBe("high")
    expect(menuClaims(healthy).length).toBeGreaterThan(0)
  })

  it("still emits menu.* for a new location with no coverage verdict at all", () => {
    // Absence of a verdict must not mute a brand-new location: unknown is unknown, not bad.
    const fresh = stampMenuCoverage(capture(98, "2026-08-09", 25).raw_data, [])
    expect(fresh.parseMeta.confidence).toBe("unknown")
    expect(menuClaims(fresh).length).toBeGreaterThan(0)
  })
})
