import { describe, it, expect } from "vitest"
import { applyHarmReview, dropThreshold, type HarmVerdict } from "@/lib/skills/safety-review"
import { recalibrateTolerance, playKey, type PlayFeedback } from "@/lib/skills/preferences"
import type { EnrichedRecommendation } from "@/lib/skills/types"

function p(title: string): EnrichedRecommendation {
  return {
    title,
    rationale: "r",
    skillId: "marketing",
    ownerRole: "marketing",
    kind: "capitalize",
    recipe: [{ channel: "c", platforms: [], audience: "a", window: { note: "w" } }],
    confidence: "high",
    evidenceRefs: ["x"],
    knowledgeVersion: "v1",
  }
}

const plays = [p("sev3"), p("sev2"), p("sev1"), p("sev0")]
const verdicts: HarmVerdict[] = [
  { index: 0, severity: 3, reason: "" },
  { index: 1, severity: 2, reason: "" },
  { index: 2, severity: 1, reason: "" },
  { index: 3, severity: 0, reason: "" },
]

describe("tolerance-aware brand-fit review", () => {
  it("dropThreshold maps the slider to a drop line", () => {
    expect(dropThreshold(10)).toBe(2) // tame
    expect(dropThreshold(50)).toBe(3) // balanced
    expect(dropThreshold(90)).toBe(4) // adventurous (never drop)
  })

  it("tame (20): drops moderate AND severe", () => {
    const { kept, dropped } = applyHarmReview(plays, verdicts, 20)
    expect(dropped.map((d) => d.play.title).sort()).toEqual(["sev2", "sev3"])
    expect(kept.find((x) => x.title === "sev1")?.confidence).toBe("medium") // mild nudged down
    expect(kept.find((x) => x.title === "sev0")?.confidence).toBe("high")
  })

  it("balanced (50): drops severe only, downgrades the rest", () => {
    const { kept, dropped } = applyHarmReview(plays, verdicts, 50)
    expect(dropped.map((d) => d.play.title)).toEqual(["sev3"])
    expect(kept.find((x) => x.title === "sev2")?.confidence).toBe("directional")
  })

  it("adventurous (80): drops nothing, shows wild ideas at low confidence", () => {
    const { kept, dropped } = applyHarmReview(plays, verdicts, 80)
    expect(dropped.length).toBe(0)
    expect(kept.find((x) => x.title === "sev3")?.confidence).toBe("directional") // wild, but low confidence
    expect(kept.find((x) => x.title === "sev2")?.confidence).toBe("directional")
  })
})

describe("recalibrateTolerance", () => {
  it("raises tolerance when wild plays get liked, lowers when disliked", () => {
    const up: PlayFeedback[] = [
      { playKey: "a", verdict: "good", severity: 3 },
      { playKey: "b", verdict: "good", severity: 2 },
    ]
    expect(recalibrateTolerance(50, up)).toBe(66) // +8 +8

    const down: PlayFeedback[] = [{ playKey: "c", verdict: "bad", severity: 3 }]
    expect(recalibrateTolerance(50, down)).toBe(42)
  })

  it("barely moves on tame-play feedback and clamps to 0-100", () => {
    expect(recalibrateTolerance(50, [{ playKey: "a", verdict: "good", severity: 0 }])).toBe(50)
    expect(recalibrateTolerance(2, [{ playKey: "a", verdict: "bad", severity: 3 }])).toBe(0) // clamp
    expect(recalibrateTolerance(98, Array(5).fill({ playKey: "a", verdict: "good", severity: 3 }))).toBe(100) // clamp
  })
})

describe("playKey", () => {
  it("is a stable slug of skill + title", () => {
    expect(playKey({ skillId: "marketing", title: "Run a Pre-Show Push!" })).toBe("marketing:run-a-pre-show-push")
  })
})
