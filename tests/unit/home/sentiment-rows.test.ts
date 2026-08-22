import { describe, expect, it } from "vitest"
import { playSentiment } from "@/app/(dashboard)/home/pass-map"
import type { EnrichedRecommendation } from "@/lib/skills/types"

// ── ALT-706 ─────────────────────────────────────────────────────────────────────────────────
// `pct` is a category's share of ALL categorized review mentions, positive included. The row tone
// was derived from that share (>=30% painted red), and the heading read "Negative sentiment by
// category". So a location whose reviews rave about the food got a red Food bar filed under
// negative sentiment.
//
// `direction` already answered good-or-bad. It was computed in presentation.ts and discarded here:
// a field with no reader driving a claim, the same defect as ALT-733.

const play = (cats: Array<{ category: string; pct: number; direction: "positive" | "negative" | "mixed" }>) =>
  ({ presentation: { sentimentByCategory: cats } }) as unknown as EnrichedRecommendation

describe("playSentiment: tone follows sentiment, not popularity (ALT-706)", () => {
  it("a heavily-discussed POSITIVE category is not an alarm", () => {
    const rows = playSentiment(play([{ category: "food", pct: 62, direction: "positive" }]))
    expect(rows?.[0].tone).toBe("ok")
    expect(rows?.[0].value).toBe("62%")
  })

  it("a barely-discussed NEGATIVE category still reads as a problem", () => {
    const rows = playSentiment(play([{ category: "wait", pct: 4, direction: "negative" }]))
    expect(rows?.[0].tone).toBe("bad")
  })

  it("mixed sits between the two", () => {
    const rows = playSentiment(play([{ category: "price", pct: 20, direction: "mixed" }]))
    expect(rows?.[0].tone).toBe("warn")
  })

  it("share alone never decides tone", () => {
    // The exact case that shipped: 30%+ was red regardless of sentiment.
    for (const pct of [30, 45, 80, 100]) {
      expect(playSentiment(play([{ category: "food", pct, direction: "positive" }]))?.[0].tone).toBe("ok")
    }
    for (const pct of [1, 5, 17]) {
      expect(playSentiment(play([{ category: "food", pct, direction: "negative" }]))?.[0].tone).toBe("bad")
    }
  })

  it("carries direction through, so the tone is explainable", () => {
    const rows = playSentiment(play([{ category: "service", pct: 33, direction: "negative" }]))
    expect(rows?.[0].direction).toBe("negative")
    expect(rows?.[0].tip).toContain("negative")
  })

  it("still clamps the percentage and caps the row count", () => {
    const rows = playSentiment(
      play(
        ["food", "service", "wait", "price", "cleanliness"].map((category) => ({
          category,
          pct: 150,
          direction: "positive" as const,
        })),
      ),
    )
    expect(rows).toHaveLength(4)
    expect(rows?.[0].value).toBe("100%")
  })

  it("returns null when a play has no category breakdown", () => {
    expect(playSentiment(play([]))).toBeNull()
    expect(playSentiment({} as unknown as EnrichedRecommendation)).toBeNull()
  })
})
