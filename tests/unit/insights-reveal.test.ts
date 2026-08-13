import { describe, expect, it } from "vitest"
import { revealPlan } from "@/app/(dashboard)/insights/insights-reveal"

// ALT-292: the regression these guard is "Show 64 more" loading all 64 at once.
// (The recency-window helpers that used to live beside the planner retired with the
// per-category feed in the 2026-08-13 /insights consolidation; the planner's
// recentCount contract stays, so a recency-banded section can return.)

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
    // The consolidated /insights sections pass recentCount: 0.
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

  it("walks a 70-insight section to the end in batches, never in one jump", () => {
    const total = 70
    let shown = 6

    const steps: number[] = []
    while (true) {
      const plan = revealPlan({ shown, recentCount: 0, total, batch: 6 })
      if (plan.nextCount === 0) break
      expect(plan.nextCount).toBeLessThanOrEqual(6)
      steps.push(plan.nextCount)
      shown += plan.nextCount
    }
    expect(shown).toBe(total)
    expect(steps.length).toBeGreaterThan(9)
  })
})
