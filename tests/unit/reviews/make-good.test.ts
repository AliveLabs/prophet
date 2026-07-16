// ALT-349/352 — band logic + make-good recommendation. Pure functions, so these
// tests pin the WHOLE decision table: verdict overrides, unscored neutrality,
// reviewer-signal degradation, threshold monotonicity, and the two hard caps
// (doubtful reviews and red flags never earn a give-away).

import { describe, it, expect } from "vitest"
import {
  GENEROSITY_DEFAULT,
  MAKE_GOOD_TUNING,
  genuinenessBand,
  severityBandFor,
  recommendMakeGood,
} from "@/lib/reviews/make-good"
import type { LocationReviewRow, MakeGoodTier, ReviewerSignals } from "@/lib/reviews/types"

/** Minimal row factory — every column present, scoring/triage columns neutral. */
function rowWith(partial: Partial<LocationReviewRow> = {}): LocationReviewRow {
  return {
    id: "row-1",
    location_id: "loc-1",
    source: "google_places",
    source_review_id: "reviews/abc",
    author_name: "Pat",
    author_key: "name:pat",
    rating: 1,
    review_text: "Waited forever and the order was wrong.",
    published_at: "2026-07-01T12:00:00Z",
    relative_published: "2 weeks ago",
    google_maps_uri: null,
    first_seen_at: "2026-07-01T12:00:00Z",
    last_seen_at: "2026-07-15T12:00:00Z",
    authenticity_score: null,
    authenticity_confidence: null,
    authenticity_rationale: null,
    severity_score: null,
    severity_rationale: null,
    sentiment_score: null,
    red_flags: null,
    scored_at: null,
    score_version: null,
    triage_status: "open",
    triage_updated_at: null,
    operator_verdict: null,
    operator_verdict_at: null,
    draft_text: null,
    draft_generated_at: null,
    ...partial,
  }
}

const hostileSignals: ReviewerSignals = { reviewCount: 3, negativeShare: 1, bursty: false }
const burstySignals: ReviewerSignals = { reviewCount: 2, negativeShare: 1, bursty: true }
const benignSignals: ReviewerSignals = { reviewCount: 4, negativeShare: 0.25, bursty: false }

describe("genuinenessBand", () => {
  it("unscored rows render neutrally: null authenticity_score -> genuine", () => {
    expect(genuinenessBand(rowWith({ authenticity_score: null }))).toBe("genuine")
  })

  it("maps scores onto the tuned band edges", () => {
    expect(genuinenessBand(rowWith({ authenticity_score: MAKE_GOOD_TUNING.cautionBelow }))).toBe("genuine")
    expect(genuinenessBand(rowWith({ authenticity_score: MAKE_GOOD_TUNING.cautionBelow - 1 }))).toBe("caution")
    expect(genuinenessBand(rowWith({ authenticity_score: MAKE_GOOD_TUNING.suspectBelow }))).toBe("caution")
    expect(genuinenessBand(rowWith({ authenticity_score: MAKE_GOOD_TUNING.suspectBelow - 1 }))).toBe("suspect")
    expect(genuinenessBand(rowWith({ authenticity_score: 0 }))).toBe("suspect")
    expect(genuinenessBand(rowWith({ authenticity_score: 100 }))).toBe("genuine")
  })

  it("operator verdict overrides the score in BOTH directions", () => {
    expect(genuinenessBand(rowWith({ authenticity_score: 5, operator_verdict: "genuine" }))).toBe("genuine")
    expect(genuinenessBand(rowWith({ authenticity_score: 95, operator_verdict: "not_genuine" }))).toBe("suspect")
  })

  it("operator verdict also overrides reviewer-signal degradation", () => {
    expect(genuinenessBand(rowWith({ authenticity_score: 90, operator_verdict: "genuine" }), hostileSignals)).toBe("genuine")
  })

  it("hostile reviewer signals (repeat all-negative) degrade one band", () => {
    expect(genuinenessBand(rowWith({ authenticity_score: 90 }), hostileSignals)).toBe("caution")
    expect(genuinenessBand(rowWith({ authenticity_score: 40 }), hostileSignals)).toBe("suspect")
    // suspect has no further band to fall to
    expect(genuinenessBand(rowWith({ authenticity_score: 10 }), hostileSignals)).toBe("suspect")
  })

  it("a bursty all-negative author degrades one band too", () => {
    expect(genuinenessBand(rowWith({ authenticity_score: 90 }), burstySignals)).toBe("caution")
  })

  it("benign reviewer signals do NOT degrade", () => {
    expect(genuinenessBand(rowWith({ authenticity_score: 90 }), benignSignals)).toBe("genuine")
  })
})

describe("severityBandFor", () => {
  it("unscored rows render neutrally: null severity_score -> mild", () => {
    expect(severityBandFor(rowWith({ severity_score: null }))).toBe("mild")
  })

  it("maps scores onto the tuned band edges", () => {
    expect(severityBandFor(rowWith({ severity_score: MAKE_GOOD_TUNING.seriousAt - 1 }))).toBe("mild")
    expect(severityBandFor(rowWith({ severity_score: MAKE_GOOD_TUNING.seriousAt }))).toBe("serious")
    expect(severityBandFor(rowWith({ severity_score: MAKE_GOOD_TUNING.crisisAt - 1 }))).toBe("serious")
    expect(severityBandFor(rowWith({ severity_score: MAKE_GOOD_TUNING.crisisAt }))).toBe("crisis")
  })

  it("any red flag is crisis regardless of the score", () => {
    expect(severityBandFor(rowWith({ severity_score: 10, red_flags: ["illness"] }))).toBe("crisis")
    expect(severityBandFor(rowWith({ severity_score: null, red_flags: ["discrimination"] }))).toBe("crisis")
  })

  it("an empty red_flags array does not force crisis", () => {
    expect(severityBandFor(rowWith({ severity_score: 10, red_flags: [] }))).toBe("mild")
  })
})

describe("recommendMakeGood", () => {
  const generous = { threshold: 100 }

  it("red flags force respond + ownerAttention, even at max generosity", () => {
    const rec = recommendMakeGood(rowWith({ severity_score: 90, red_flags: ["illness"], authenticity_score: 95 }), generous)
    expect(rec.tier).toBe("respond")
    expect(rec.ownerAttention).toBe(true)
  })

  it("crisis-band severity forces respond + ownerAttention even without red flags", () => {
    const rec = recommendMakeGood(rowWith({ severity_score: MAKE_GOOD_TUNING.crisisAt, authenticity_score: 95 }), generous)
    expect(rec.tier).toBe("respond")
    expect(rec.ownerAttention).toBe(true)
  })

  it("suspect genuineness never exceeds respond, at any severity or threshold", () => {
    for (const severity of [40, 60, 79]) {
      const rec = recommendMakeGood(rowWith({ authenticity_score: 10, severity_score: severity }), generous)
      expect(rec.tier).toBe("respond")
      expect(rec.ownerAttention).toBe(false)
    }
  })

  it("caution genuineness drops the make-good ONE rung: a doubtful reviewer can get a meal, never a refund", () => {
    // threshold 100: offerAt = 34, fullAt = 70. severity 75 earns the full rung
    // when genuine; caution steps it down to replace_meal (Bryan 2026-07-17).
    const genuine = recommendMakeGood(rowWith({ authenticity_score: 95, severity_score: 75 }), generous)
    expect(genuine.remediation).toBe("refund_and_replace")
    const doubted = recommendMakeGood(rowWith({ authenticity_score: 40, severity_score: 75 }), generous)
    expect(doubted.remediation).toBe("replace_meal")
    expect(doubted.tier).toBe("comp")
  })

  it("an operator not_genuine verdict caps a high-scoring review at respond", () => {
    const rec = recommendMakeGood(rowWith({ authenticity_score: 95, severity_score: 79, operator_verdict: "not_genuine" }), generous)
    expect(rec.tier).toBe("respond")
  })

  it("hostile reviewer signals (the serial one-star account) drop the rung too", () => {
    const rec = recommendMakeGood(rowWith({ authenticity_score: 90, severity_score: 75 }), { threshold: 100, signals: hostileSignals })
    expect(rec.remediation).toBe("replace_meal")
    expect(rec.remediation).not.toBe("refund_and_replace")
  })

  it("positive reviews never get a make-good (thanks only)", () => {
    for (const rating of [3, 4, 5]) {
      const rec = recommendMakeGood(rowWith({ rating, authenticity_score: 95, severity_score: 79 }), generous)
      expect(rec.tier).toBe("respond")
      expect(rec.ownerAttention).toBe(false)
    }
  })

  it("unscored severity stays at respond (neutral posture, never a blind give-away)", () => {
    const rec = recommendMakeGood(rowWith({ severity_score: null, authenticity_score: 95 }), generous)
    expect(rec.tier).toBe("respond")
  })

  it("the whole 'Respond first' slider band offers nothing, at any severity", () => {
    for (const threshold of [0, 15, MAKE_GOOD_TUNING.respondOnlyMax]) {
      const rec = recommendMakeGood(rowWith({ authenticity_score: 95, severity_score: 79 }), { threshold })
      expect(rec.remediation).toBe("none")
      expect(rec.tier).toBe("respond")
    }
  })

  it("a generous threshold climbs the whole ladder as severity rises", () => {
    // threshold 100: offerAt = max(34, 70-60) = 34, fullAt = max(42, 95-25) = 70, step = 12
    const at = (severity: number) => recommendMakeGood(rowWith({ authenticity_score: 95, severity_score: severity }), generous)
    expect(at(33).remediation).toBe("none")
    expect(at(34).remediation).toBe("replace_side")
    expect(at(46).remediation).toBe("treat")
    expect(at(58).remediation).toBe("replace_meal")
    expect(at(70).remediation).toBe("refund_and_replace")
    expect(at(34).tier).toBe("discount")
    expect(at(58).tier).toBe("comp")
  })

  it("raising the threshold moves the tier monotonically (never down)", () => {
    const rank: Record<MakeGoodTier, number> = { respond: 0, discount: 1, comp: 2 }
    const row = rowWith({ authenticity_score: 95, severity_score: 72 })
    let prev = -1
    for (let threshold = 0; threshold <= 100; threshold += 10) {
      const tier = recommendMakeGood(row, { threshold }).tier
      expect(rank[tier], `threshold ${threshold} regressed the tier`).toBeGreaterThanOrEqual(prev)
      prev = rank[tier]
    }
  })

  it("GENEROSITY_DEFAULT (50) is measured: small gestures on serious complaints, refund unreachable", () => {
    // default 50: offerAt = 70 - 30 = 40, fullAt = 95 - 12.5 = 82.5, step ~14.2.
    // The refund rung starts at 82.5, above the crisis edge (80) where the owner
    // takes over personally, so refunds are out of reach at the default.
    const at = (severity: number) => recommendMakeGood(rowWith({ authenticity_score: 95, severity_score: severity }), { threshold: GENEROSITY_DEFAULT })
    expect(at(39).remediation).toBe("none")
    expect(at(42).remediation).toBe("replace_side")
    expect(at(60).remediation).toBe("treat")
    expect(at(70).remediation).toBe("replace_meal")
    expect(at(79).remediation).toBe("replace_meal")
  })

  it("every recommendation carries a plain-language rationale with no em dashes or raw scores", () => {
    const rows = [
      rowWith({ severity_score: 90, red_flags: ["illness"] }),
      rowWith({ authenticity_score: 10, severity_score: 60 }),
      rowWith({ authenticity_score: 40, severity_score: 60 }),
      rowWith({ rating: 5, authenticity_score: 95, severity_score: 5 }),
      rowWith({ authenticity_score: 95, severity_score: 50 }),
      rowWith({ authenticity_score: 95, severity_score: 75 }),
    ]
    for (const row of rows) {
      const rec = recommendMakeGood(row, generous)
      expect(rec.rationale.length).toBeGreaterThan(0)
      expect(rec.rationale).not.toMatch(/—/) // voice rule: no em dashes in operator copy
      expect(rec.rationale).not.toMatch(/\d{2,}/) // never surface raw 0-100 scores
    }
  })
})
