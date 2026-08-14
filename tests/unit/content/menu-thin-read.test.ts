// Thin-read rejection, tested against the REAL stored history that motivated it.
//
// One restaurant's weekly menu captures, read out of prod on 2026-08-14. Merged totals:
//   08-09 137, 08-02 169, 07-26 69, 07-19 81, 07-17 70, 07-12 12, 07-07 30, 07-05 81 ...
// The page never changed. Splitting parseMeta.notes by source shows the same three URLs
// producing wildly different counts run to run, and every small value is one section of a
// page whose full text was present:
//   dinner-menu   full 60 (6 categories)   thin 9  ("STARTERS" only) or 1
//   drink-menu    full 58 (5 categories)   thin 18 ("SPECIALTY COCKTAILS" only) or 19
//   brunch-menu   full 22 (3 categories)   thin 3  ("Handhelds" only)
//
// Every one of those thin values must be rejected, and every full value kept.

import { describe, it, expect } from "vitest"
import {
  assessThinRead,
  menuPageBaseline,
  collectPageHistory,
  acceptedItemCount,
  THIN_READ_RATIO,
  MIN_BASELINE_ITEMS,
} from "@/lib/content/menu-thin-read"
import type { MenuSnapshot } from "@/lib/content/types"

// Real per-URL series, newest first.
const DINNER = [60, 60, 9, 60, 9, 9, 9, 9, 63, 9, 9, 9, 1, 9, 9, 9]
const DRINK = [58, 58, 18, 58, 19, 18, 18, 22, 58, 58]
const BRUNCH = [22, 22, 3, 3, 3, 22, 3, 3]

describe("menuPageBaseline", () => {
  it("takes the best read, not a central one, because most reads may be broken", () => {
    // Eleven 9-item reads and one 63 for the same page. Any median or second-highest
    // statistic here ratifies the broken reads as normal.
    expect(menuPageBaseline(DINNER)).toBe(63)
    expect(menuPageBaseline(DRINK)).toBe(58)
    expect(menuPageBaseline(BRUNCH)).toBe(22)
  })

  it("has no opinion until there are two credible reads", () => {
    expect(menuPageBaseline([])).toBeNull()
    expect(menuPageBaseline([60])).toBeNull()
    expect(menuPageBaseline([60, 0])).toBeNull()
    expect(menuPageBaseline([60, 58])).toBe(60)
  })

  it("refuses to judge against a tiny baseline", () => {
    expect(menuPageBaseline([3, 2, 3])).toBeNull()
    expect(menuPageBaseline([MIN_BASELINE_ITEMS, MIN_BASELINE_ITEMS])).toBe(MIN_BASELINE_ITEMS)
  })
})

describe("assessThinRead against the real Sugarbacon history", () => {
  it("rejects every thin dinner-menu read and keeps every full one", () => {
    expect(assessThinRead(9, DINNER).thin).toBe(true)
    expect(assessThinRead(1, DINNER).thin).toBe(true)
    expect(assessThinRead(60, DINNER).thin).toBe(false)
    expect(assessThinRead(63, DINNER).thin).toBe(false)
  })

  it("rejects the drink-menu first-section reads", () => {
    expect(assessThinRead(18, DRINK).thin).toBe(true)
    expect(assessThinRead(19, DRINK).thin).toBe(true)
    expect(assessThinRead(58, DRINK).thin).toBe(false)
  })

  it("rejects the brunch-menu single-section read", () => {
    expect(assessThinRead(3, BRUNCH).thin).toBe(true)
    expect(assessThinRead(22, BRUNCH).thin).toBe(false)
  })

  it("would have caught every bad stored run on this restaurant", () => {
    // The per-source counts behind each stored snapshot, and what survives the rule.
    const runs: Array<{ dateKey: string; dinner: number; drink: number; brunch: number }> = [
      { dateKey: "2026-08-09", dinner: 60, drink: 58, brunch: 22 },
      { dateKey: "2026-07-26", dinner: 9, drink: 58, brunch: 3 },
      { dateKey: "2026-07-19", dinner: 60, drink: 18, brunch: 3 },
      { dateKey: "2026-07-12", dinner: 9, drink: 0, brunch: 3 },
      { dateKey: "2026-07-05", dinner: 63, drink: 18, brunch: 0 },
    ]
    const rejected = runs.map((run) => ({
      dateKey: run.dateKey,
      // A page that produced nothing at all is a fetch failure, already counted elsewhere;
      // only pages that DID return items are judged for thinness here.
      thin: [
        run.dinner > 0 && assessThinRead(run.dinner, DINNER).thin,
        run.drink > 0 && assessThinRead(run.drink, DRINK).thin,
        run.brunch > 0 && assessThinRead(run.brunch, BRUNCH).thin,
      ].filter(Boolean).length,
    }))
    expect(rejected).toEqual([
      { dateKey: "2026-08-09", thin: 0 },
      { dateKey: "2026-07-26", thin: 2 },
      { dateKey: "2026-07-19", thin: 2 },
      { dateKey: "2026-07-12", thin: 2 },
      { dateKey: "2026-07-05", thin: 1 },
    ])
  })

  it("reports the ratio it judged on so a rejection is explainable", () => {
    const verdict = assessThinRead(9, DINNER)
    expect(verdict.baseline).toBe(63)
    expect(verdict.ratio).toBe(0.14)
    expect(verdict.ratio!).toBeLessThan(THIN_READ_RATIO)
  })

  it("never calls a read thin when there is no history to judge it against", () => {
    expect(assessThinRead(3, []).thin).toBe(false)
    expect(assessThinRead(0, [60]).thin).toBe(false)
  })

  it("keeps a read that grew, which is a menu expansion and not a failure", () => {
    expect(assessThinRead(200, [80, 79, 69]).thin).toBe(false)
  })
})

function snapshot(pages: MenuSnapshot["parseMeta"]["pages"]): MenuSnapshot {
  return {
    menuUrl: null,
    capturedAt: "2026-08-14T00:00:00.000Z",
    screenshot: null,
    currency: "USD",
    categories: [],
    parseMeta: { itemsTotal: 0, confidence: "low", notes: [], pages },
  }
}

describe("collectPageHistory", () => {
  it("groups counts per URL, newest first", () => {
    const history = collectPageHistory([
      snapshot([
        { url: "https://x.com/dinner", items: 60, extractor: "markdown", thin: false, attempts: 1 },
        { url: "https://x.com/drink", items: 58, extractor: "markdown", thin: false, attempts: 1 },
      ]),
      snapshot([
        { url: "https://x.com/dinner", items: 63, extractor: "model", thin: false, attempts: 1 },
      ]),
    ])
    expect(history.get("https://x.com/dinner")).toEqual([60, 63])
    expect(history.get("https://x.com/drink")).toEqual([58])
  })

  it("excludes reads already rejected as thin, so a bad read cannot become the baseline", () => {
    const history = collectPageHistory([
      snapshot([{ url: "https://x.com/a", items: 9, extractor: "model", thin: true, attempts: 2 }]),
      snapshot([{ url: "https://x.com/a", items: 60, extractor: "model", thin: false, attempts: 1 }]),
      snapshot([{ url: "https://x.com/a", items: 58, extractor: "model", thin: false, attempts: 1 }]),
    ])
    expect(history.get("https://x.com/a")).toEqual([60, 58])
  })

  it("has nothing to say about snapshots captured before parseMeta.pages existed", () => {
    const legacy = snapshot(undefined)
    expect(collectPageHistory([legacy, null, undefined]).size).toBe(0)
  })
})

describe("acceptedItemCount", () => {
  it("counts only the pages that were accepted", () => {
    expect(
      acceptedItemCount([
        { url: "a", items: 60, extractor: "markdown", thin: false, attempts: 1 },
        { url: "b", items: 9, extractor: "model", thin: true, attempts: 2 },
        { url: "c", items: 22, extractor: "markdown", thin: false, attempts: 1 },
      ])
    ).toBe(82)
  })
})
