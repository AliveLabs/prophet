// ALT-355 — the review-triage signal band. Nothing consumes these yet (see the
// module header: future learning only, NOT feedback-rollup); these tests pin the
// map's completeness + the provisional tiering so a retune is a deliberate edit.

import { describe, it, expect } from "vitest"
import { REVIEW_SIGNAL_MAP, signalForReviewAction, type ReviewTriageAction } from "@/lib/reviews/review-signals"

const ALL_ACTIONS: ReviewTriageAction[] = ["marked_responded", "dismissed", "verdict_genuine", "verdict_not_genuine"]

describe("REVIEW_SIGNAL_MAP", () => {
  it("has a well-formed entry for every triage action", () => {
    for (const action of ALL_ACTIONS) {
      const signal = REVIEW_SIGNAL_MAP[action]
      expect(signal, `missing entry for ${action}`).toBeDefined()
      expect([-1, 0, 1]).toContain(signal.polarity)
      expect(signal.weight).toBeGreaterThanOrEqual(0)
      expect(signal.confidence).toBeGreaterThanOrEqual(0)
      expect(signal.confidence).toBeLessThanOrEqual(1)
    }
  })

  it("verdicts are the explicit, high-confidence, full-weight signals", () => {
    expect(REVIEW_SIGNAL_MAP.verdict_genuine).toEqual({ polarity: 1, weight: 1, confidence: 0.9 })
    expect(REVIEW_SIGNAL_MAP.verdict_not_genuine).toEqual({ polarity: -1, weight: 1, confidence: 0.9 })
  })

  it("responded is a mild positive engagement lean, well below a verdict", () => {
    expect(REVIEW_SIGNAL_MAP.marked_responded).toEqual({ polarity: 1, weight: 0.3, confidence: 0.5 })
  })

  it("dismissed is visibility housekeeping: zero learning weight", () => {
    expect(REVIEW_SIGNAL_MAP.dismissed).toEqual({ polarity: 0, weight: 0, confidence: 0 })
  })
})

describe("signalForReviewAction", () => {
  it("returns the map entry for known actions", () => {
    for (const action of ALL_ACTIONS) {
      expect(signalForReviewAction(action)).toEqual(REVIEW_SIGNAL_MAP[action])
    }
  })

  it("degrades unknown/legacy actions to a neutral no-op (never throws)", () => {
    expect(signalForReviewAction("some_future_action")).toEqual({ polarity: 0, weight: 0, confidence: 0 })
    expect(signalForReviewAction("")).toEqual({ polarity: 0, weight: 0, confidence: 0 })
  })
})
