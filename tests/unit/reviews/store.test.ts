// Review Intelligence — pure store helpers (adversarial-review fixes, 2026-07-16).
// changedReviewIds: an edited review (same stable id, new text/rating) must be
// flagged for re-scoring; chunkRows: the scoring pass bounds each LLM call.

import { describe, expect, it } from "vitest"
import { changedReviewIds } from "@/lib/reviews/store"
import { chunkRows } from "@/lib/reviews/scoring"
import type { CapturedReview } from "@/lib/reviews/types"

const cap = (id: string, text: string, rating: number | null): CapturedReview => ({
  sourceReviewId: id,
  text,
  rating,
})

describe("changedReviewIds", () => {
  it("flags text edits under a stable id (the 5-star -> food-poisoning edit)", () => {
    const changed = changedReviewIds(
      [cap("r1", "got food poisoning here", 1)],
      [{ source_review_id: "r1", review_text: "loved it", rating: 5 }],
    )
    expect(changed.has("r1")).toBe(true)
  })

  it("flags rating-only changes", () => {
    const changed = changedReviewIds(
      [cap("r1", "same text", 1)],
      [{ source_review_id: "r1", review_text: "same text", rating: 4 }],
    )
    expect(changed.has("r1")).toBe(true)
  })

  it("ignores unchanged rows and brand-new ids (new rows start unscored anyway)", () => {
    const changed = changedReviewIds(
      [cap("r1", "same", 3), cap("r2", "new review", 5)],
      [{ source_review_id: "r1", review_text: "same", rating: 3 }],
    )
    expect(changed.size).toBe(0)
  })

  it("treats null text and empty text as equal (no phantom resets)", () => {
    const changed = changedReviewIds(
      [cap("r1", "", 2)],
      [{ source_review_id: "r1", review_text: null, rating: 2 }],
    )
    expect(changed.size).toBe(0)
  })
})

describe("chunkRows", () => {
  it("splits a 60-row backlog into bounded chunks (no single-call truncation stall)", () => {
    const chunks = chunkRows(Array.from({ length: 60 }, (_, i) => i))
    expect(chunks.length).toBeGreaterThan(1)
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(15)
    expect(chunks.flat()).toHaveLength(60)
  })

  it("keeps the steady-state daily inflow to a single chunk", () => {
    expect(chunkRows([1, 2, 3, 4, 5])).toHaveLength(1)
  })

  it("handles empty input", () => {
    expect(chunkRows([])).toHaveLength(0)
  })
})
