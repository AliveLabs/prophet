// Review-backfill: the pure candidate-selection logic. Pins seed-before-topup
// ordering, the top-up interval boundary, oldest-first drain, the per-run cap, and
// the skip of locations without a place id.

import { describe, it, expect } from "vitest"
import { selectReviewBackfillCandidates } from "@/lib/jobs/backfill/reviews-refresh"

const TODAY = "2026-07-20" // a Monday

function loc(id: string, place: string | null = `place_${id}`) {
  return { id, primary_place_id: place }
}

describe("selectReviewBackfillCandidates", () => {
  it("never-seeded locations are picked as seeds, before any top-up", () => {
    const locations = [loc("a"), loc("b")]
    const last = new Map([["b", "2026-07-01"]]) // b is well overdue for a top-up
    const out = selectReviewBackfillCandidates(locations, last, { today: TODAY, max: 10 })
    expect(out.map((c) => [c.locationId, c.mode])).toEqual([
      ["a", "seed"],
      ["b", "topup"],
    ])
  })

  it("skips locations pulled within the interval, includes those older", () => {
    const locations = [loc("fresh"), loc("stale")]
    const last = new Map([
      ["fresh", "2026-07-18"], // 2 days ago -> within 7-day interval -> skip
      ["stale", "2026-07-10"], // 10 days ago -> due
    ])
    const out = selectReviewBackfillCandidates(locations, last, { today: TODAY, max: 10 })
    expect(out.map((c) => c.locationId)).toEqual(["stale"])
  })

  it("orders top-ups oldest-pulled first", () => {
    const locations = [loc("x"), loc("y"), loc("z")]
    const last = new Map([
      ["x", "2026-07-05"],
      ["y", "2026-06-20"],
      ["z", "2026-07-01"],
    ])
    const out = selectReviewBackfillCandidates(locations, last, { today: TODAY, max: 10 })
    expect(out.map((c) => c.locationId)).toEqual(["y", "z", "x"])
  })

  it("caps the batch at max (seeds retain priority)", () => {
    const locations = [loc("s1"), loc("s2"), loc("old")]
    const last = new Map([["old", "2026-06-01"]])
    const out = selectReviewBackfillCandidates(locations, last, { today: TODAY, max: 2 })
    expect(out.map((c) => c.locationId)).toEqual(["s1", "s2"]) // both seeds fill the cap; topup waits
  })

  it("respects a custom interval boundary", () => {
    const locations = [loc("edge")]
    const last = new Map([["edge", "2026-07-17"]]) // 3 days ago
    // interval 2 -> dueBefore = 2026-07-18; 07-17 < 07-18 -> due
    expect(selectReviewBackfillCandidates(locations, last, { today: TODAY, intervalDays: 2, max: 5 })).toHaveLength(1)
    // interval 5 -> dueBefore = 2026-07-15; 07-17 not < 07-15 -> not due
    expect(selectReviewBackfillCandidates(locations, last, { today: TODAY, intervalDays: 5, max: 5 })).toHaveLength(0)
  })

  it("skips locations with no place id", () => {
    const out = selectReviewBackfillCandidates([loc("np", null)], new Map(), { today: TODAY, max: 5 })
    expect(out).toHaveLength(0)
  })
})
