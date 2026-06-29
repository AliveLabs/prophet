// ALT-167 (DISPLAY) — confidence and impact are TWO separate scores on a play card,
// and the IMPACT score must ALWAYS resolve (it disappeared on some locations because a
// play can carry no sized leverage). These lock the impactLevel/impactLabel helpers that
// the Pass play card + detail page render so an Impact score can never silently vanish,
// and so the displayed impact MATCHES the value the ranker actually scores on (the
// calibrated impact — a maintain play with no failure signal is capped at low).

import { describe, it, expect } from "vitest"
import { impactLevel, impactLabel } from "@/app/(dashboard)/home/pass-map"
import type { EnrichedRecommendation } from "@/lib/skills/types"

// Minimal play factory — only the fields the impact helpers read.
function play(overrides: Partial<EnrichedRecommendation> = {}): EnrichedRecommendation {
  return {
    title: "Test play",
    rationale: "why",
    skillId: "test-skill",
    ownerRole: "owner",
    kind: "capitalize",
    recipe: [],
    confidence: "high",
    evidenceRefs: [],
    knowledgeVersion: "v1",
    ...overrides,
  }
}

describe("ALT-167 — impact display always resolves", () => {
  it("reflects a play's declared leverage label", () => {
    expect(impactLevel(play({ leverage: { label: "high", basisInternal: "x" } }))).toBe("high")
    expect(impactLevel(play({ leverage: { label: "low", basisInternal: "x" } }))).toBe("low")
  })

  it("NEVER returns null/undefined — a play with NO leverage falls back to medium (the engine default), so Impact always renders", () => {
    const lvl = impactLevel(play({ leverage: undefined }))
    expect(lvl).toBe("medium")
    expect(impactLabel(play({ leverage: undefined }))).toBe("Medium")
  })

  it("an advantage / 'you're winning' play still resolves a real impact (the win-flag never erases the score)", () => {
    const lvl = impactLevel(play({ presentation: { advantage: true }, leverage: { label: "high", basisInternal: "x" } }))
    expect(lvl).toBe("high")
  })

  it("matches the ranker's calibrated impact: a maintain play with NO failure signal is capped at low", () => {
    const maintainNoFailure = play({
      stance: "maintain",
      leverage: { label: "high", basisInternal: "x" },
      evidenceRefs: ["review.theme:positive"],
    })
    expect(impactLevel(maintainNoFailure)).toBe("low") // declared high, but capped — matches scoring
  })

  it("a maintain play WITH a failure signal keeps its declared impact (the cap lifts)", () => {
    const maintainWithFailure = play({
      stance: "maintain",
      leverage: { label: "high", basisInternal: "x" },
      evidenceRefs: ["review_velocity_falling:trend"],
    })
    expect(impactLevel(maintainWithFailure)).toBe("high")
  })

  it("impactLabel humanizes every tier", () => {
    expect(impactLabel(play({ leverage: { label: "high", basisInternal: "x" } }))).toBe("High")
    expect(impactLabel(play({ leverage: { label: "medium", basisInternal: "x" } }))).toBe("Medium")
    expect(impactLabel(play({ leverage: { label: "low", basisInternal: "x" } }))).toBe("Low")
  })
})
