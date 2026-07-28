import { describe, expect, it } from "vitest"
import {
  INSIGHT_RECENT_WINDOW_DAYS,
  defaultRevealCount,
  recentCutoffDateKey,
  revealPlan,
  splitByRecency,
} from "@/app/(dashboard)/insights/insights-reveal"

// ALT-292: the regression these guard is "Show 64 more" loading all 64 at once, and
// a category defaulting to every insight ever generated instead of a recent window.

describe("recentCutoffDateKey", () => {
  it("makes a 7-day window inclusive of today", () => {
    // 7 days ending 2026-07-28 starts on the 22nd, not the 21st.
    expect(recentCutoffDateKey("2026-07-28")).toBe("2026-07-22")
  })

  it("steps whole calendar days across a month boundary", () => {
    expect(recentCutoffDateKey("2026-07-03")).toBe("2026-06-27")
  })

  it("steps across a leap day", () => {
    expect(recentCutoffDateKey("2028-03-02")).toBe("2028-02-25")
  })

  it("honors a custom window and treats 1 day as today only", () => {
    expect(recentCutoffDateKey("2026-07-28", 1)).toBe("2026-07-28")
    expect(recentCutoffDateKey("2026-07-28", 30)).toBe("2026-06-29")
  })

  it("falls back to the input rather than emitting an invalid cutoff", () => {
    expect(recentCutoffDateKey("not-a-date")).toBe("not-a-date")
  })

  it("defaults to the exported window length", () => {
    expect(recentCutoffDateKey("2026-07-28")).toBe(
      recentCutoffDateKey("2026-07-28", INSIGHT_RECENT_WINDOW_DAYS),
    )
  })
})

describe("splitByRecency", () => {
  const list = [
    { id: "a", dateKey: "2026-07-28" },
    { id: "b", dateKey: "2026-07-10" },
    { id: "c", dateKey: "2026-07-22" },
    { id: "d", dateKey: "2026-07-21" },
  ]

  it("puts the recent window first and keeps server order inside each run", () => {
    const { ordered, recentCount } = splitByRecency(list, "2026-07-22")
    expect(ordered.map((i) => i.id)).toEqual(["a", "c", "b", "d"])
    expect(recentCount).toBe(2)
  })

  it("treats the cutoff date itself as recent", () => {
    expect(splitByRecency([{ dateKey: "2026-07-22" }], "2026-07-22").recentCount).toBe(1)
  })

  it("sorts a missing dateKey as older instead of dropping it", () => {
    const { ordered, recentCount } = splitByRecency(
      [{ id: "x", dateKey: null }, { id: "y", dateKey: "2026-07-28" }],
      "2026-07-22",
    )
    expect(recentCount).toBe(1)
    expect(ordered.map((i) => i.id)).toEqual(["y", "x"])
  })

  it("handles an all-older category", () => {
    const { ordered, recentCount } = splitByRecency(list, "2026-08-01")
    expect(recentCount).toBe(0)
    expect(ordered).toHaveLength(4)
  })

  it("handles an empty category", () => {
    expect(splitByRecency([], "2026-07-22")).toEqual({ ordered: [], recentCount: 0 })
  })
})

describe("defaultRevealCount", () => {
  it("opens at the recent window when it is smaller than a batch", () => {
    expect(defaultRevealCount(2, 70, 6)).toBe(2)
  })

  it("caps a large recent window at one batch", () => {
    expect(defaultRevealCount(20, 70, 6)).toBe(6)
  })

  it("still opens with a batch when nothing is recent, so the section is not empty", () => {
    expect(defaultRevealCount(0, 70, 6)).toBe(6)
  })

  it("never exceeds what exists", () => {
    expect(defaultRevealCount(0, 3, 6)).toBe(3)
    expect(defaultRevealCount(0, 0, 6)).toBe(0)
  })
})

describe("revealPlan", () => {
  it("adds one batch, not the remainder (the ALT-292 regression)", () => {
    const plan = revealPlan({ shown: 6, recentCount: 70, total: 70, batch: 6 })
    expect(plan.nextCount).toBe(6)
    expect(plan.remaining).toBe(64)
  })

  it("stops the batch at the recent boundary instead of straddling it", () => {
    // 18 of 20 recent shown: the click adds the last 2 recent, not 4 older with them.
    const plan = revealPlan({ shown: 18, recentCount: 20, total: 70, batch: 6 })
    expect(plan.nextCount).toBe(2)
    expect(plan.olderNext).toBe(false)
    expect(plan.remaining).toBe(52)
  })

  it("flags the crossing into older material once the window is exhausted", () => {
    const plan = revealPlan({ shown: 20, recentCount: 20, total: 70, batch: 6 })
    expect(plan.olderNext).toBe(true)
    expect(plan.nextCount).toBe(6)
    expect(plan.remaining).toBe(50)
  })

  it("does not flag older-next when the section has no recency notion", () => {
    // Pinned / board columns pass recentCount: 0.
    const plan = revealPlan({ shown: 8, recentCount: 0, total: 30, batch: 8 })
    expect(plan.olderNext).toBe(false)
    expect(plan.nextCount).toBe(8)
    expect(plan.remaining).toBe(22)
  })

  it("shrinks the last batch to what is actually left", () => {
    const plan = revealPlan({ shown: 66, recentCount: 0, total: 70, batch: 6 })
    expect(plan.nextCount).toBe(4)
    expect(plan.remaining).toBe(4)
  })

  it("reports nothing left once everything is shown", () => {
    const plan = revealPlan({ shown: 70, recentCount: 20, total: 70, batch: 6 })
    expect(plan.nextCount).toBe(0)
    expect(plan.remaining).toBe(0)
  })

  it("never goes negative if the list shrank under a stale reveal count", () => {
    // A dismissed card can drop `total` below what was already revealed.
    const plan = revealPlan({ shown: 12, recentCount: 4, total: 8, batch: 6 })
    expect(plan.nextCount).toBe(0)
    expect(plan.remaining).toBe(0)
  })

  it("walks a 70-insight category to the end in batches, never in one jump", () => {
    const total = 70
    const recentCount = 3
    let shown = defaultRevealCount(recentCount, total, 6)
    expect(shown).toBe(3)

    const steps: number[] = []
    while (true) {
      const plan = revealPlan({ shown, recentCount, total, batch: 6 })
      if (plan.nextCount === 0) break
      expect(plan.nextCount).toBeLessThanOrEqual(6)
      steps.push(plan.nextCount)
      shown += plan.nextCount
    }
    expect(shown).toBe(total)
    expect(steps.length).toBeGreaterThan(10)
  })
})
