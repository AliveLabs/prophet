import { describe, expect, it } from "vitest"
import {
  insightTier,
  planSummary,
  type UnifiedInsight,
} from "@/components/insights/unified-insight-card"

// The two pure decisions behind the unified insight card.
//
// `insightTier` decides which of the three treatments a record gets. It is DERIVED rather
// than stored so the card can never claim a plan it does not have.
//
// `planSummary` composes the one-line "what does this involve" from the steps that already
// exist, with no model call, so adding that line costs nothing per brief.

const base: UnifiedInsight = {
  id: "x",
  title: "t",
  why: "w",
  tags: [],
  confidence: "high",
  impact: "high",
}

describe("insightTier", () => {
  it("is a plan when there are steps", () => {
    expect(insightTier({ ...base, plan: [{ channel: "In-store" }] })).toBe("plan")
  })

  it("is a suggestion when there is only a line", () => {
    expect(insightTier({ ...base, suggestion: "Post more" })).toBe("suggestion")
  })

  it("is an observation when there is neither", () => {
    expect(insightTier(base)).toBe("observation")
  })

  it("prefers a plan over a suggestion when both are present", () => {
    expect(insightTier({ ...base, plan: [{ channel: "In-store" }], suggestion: "Post more" })).toBe("plan")
  })

  it("does not treat an empty plan array as a plan", () => {
    expect(insightTier({ ...base, plan: [] })).toBe("observation")
  })

  it("does not treat a whitespace-only suggestion as a suggestion", () => {
    // A producer emitting "" or "   " must not earn the action container.
    expect(insightTier({ ...base, suggestion: "   " })).toBe("observation")
    expect(insightTier({ ...base, suggestion: "" })).toBe("observation")
  })
})

describe("planSummary", () => {
  it("names the step count as a word, never a numeral", () => {
    const s = planSummary([{ channel: "Review replies" }, { channel: "In-store" }])
    expect(s).toBe("Two steps: Review replies and in-store.")
    expect(s).not.toMatch(/\d/)
  })

  it("uses the singular for one step", () => {
    expect(planSummary([{ channel: "Your Google Business Profile" }])).toBe(
      "One step: Your Google Business Profile.",
    )
  })

  it("joins three or more channels with commas and a final and", () => {
    expect(
      planSummary([
        { channel: "Paid social" },
        { channel: "Your Google Business Profile" },
        { channel: "In-store" },
      ]),
    ).toBe("Three steps: Paid social, your Google Business Profile and in-store.")
  })

  it("collapses duplicate channels but still counts every step", () => {
    // Two review-reply steps are two steps, but naming the channel twice reads broken.
    const s = planSummary([
      { channel: "Review replies" },
      { channel: "Review replies" },
      { channel: "In-store" },
    ])
    expect(s).toBe("Three steps: Review replies and in-store.")
  })

  it("keeps the first channel's capitalisation and lowercases the rest", () => {
    // "Paid social, your listing and in-store" reads as prose; "Paid social, Your listing"
    // reads as a list of proper nouns.
    expect(planSummary([{ channel: "Paid social" }, { channel: "Your listing" }])).toBe(
      "Two steps: Paid social and your listing.",
    )
  })

  it("survives a step with a blank channel rather than printing an empty item", () => {
    expect(planSummary([{ channel: "In-store" }, { channel: "   " }])).toBe(
      "Two steps: In-store.",
    )
  })

  it("falls back to digits past the spelled-out range instead of printing undefined", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ channel: `Channel ${i}` }))
    expect(planSummary(many)).toMatch(/^9 steps:/)
  })
})
