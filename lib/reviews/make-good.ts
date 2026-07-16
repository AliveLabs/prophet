// ---------------------------------------------------------------------------
// Review Intelligence (ALT-349 + ALT-352) — bands + the make-good recommendation.
// Pure functions over a LocationReviewRow: no LLM, no I/O, unit-test heavy.
//
// ★ MAKE_GOOD_TUNING IS THE SINGLE SOURCE OF TRUTH FOR EVERY CUT-POINT. ★
// Retuning a band edge or a generosity slope is an edit HERE, never a rewrite
// of the callers (mirrors the FEEDBACK_SIGNAL_MAP retune-not-rewrite property).
//
// The raw 0-100 scores NEVER reach the operator — the UI speaks only in bands
// (genuine/caution/suspect, mild/serious/crisis) and plain-language rationales.
//
// GUARDRAIL (Bryan, 2026-07-16): genuineness exists to protect the operator's
// GENEROSITY (no give-aways on doubtful reviews) and to prioritize responses.
// Nothing here recommends removal or coaches removal-gaming — every tier is a
// flavor of RESPONDING.
// ---------------------------------------------------------------------------

import type {
  GenuinenessBand,
  LocationReviewRow,
  MakeGoodRecommendation,
  MakeGoodTier,
  ReviewerSignals,
  SeverityBand,
} from "@/lib/reviews/types"

/** Default locations.generosity_threshold for orgs that never touched the slider. */
export const GENEROSITY_DEFAULT = 40

/**
 * ★ THE TUNING BLOCK ★ — every cut-point this module uses, in one place.
 *   - cautionBelow / suspectBelow : authenticity-score band edges (score < edge).
 *   - seriousAt / crisisAt        : severity-score band edges (score >= edge).
 *   - discountBase/Slope, compBase/Slope : how generosity_threshold (0-100) moves
 *     the make-good cut-points. cut = base - threshold * slope, clamped so a
 *     make-good is never suggested below the "serious" band. At threshold 0 the
 *     discount cut sits AT the crisis edge (crisis routes to owner attention
 *     first), so the posture is respond-only; higher thresholds lower the cuts.
 *   - makeGoodMaxRating : only reviews at or below this star rating are
 *     make-good eligible (a glowing review never needs a give-away).
 *   - degradeReviewCountAt / degradeNegativeShareAt : reviewer-signal degradation
 *     gate — an author with this many reviews here, effectively all negative
 *     (or a negative burst), drops the row one genuineness band.
 */
export const MAKE_GOOD_TUNING = {
  cautionBelow: 55,
  suspectBelow: 30,
  seriousAt: 34,
  crisisAt: 80,
  discountBase: 80,
  discountSlope: 0.35,
  compBase: 95,
  compSlope: 0.25,
  makeGoodMaxRating: 2,
  degradeReviewCountAt: 2,
  degradeNegativeShareAt: 0.99,
} as const

/** One band more doubtful (genuine -> caution -> suspect; suspect stays put). */
function degradeOneBand(band: GenuinenessBand): GenuinenessBand {
  if (band === "genuine") return "caution"
  return "suspect"
}

/** True when this author's within-our-data pattern warrants a one-band degrade:
 *  repeat reviewer here who is effectively all-negative, or an all-negative burst. */
function signalsDegrade(signals: ReviewerSignals | undefined): boolean {
  if (!signals) return false
  const allNegative = signals.negativeShare >= MAKE_GOOD_TUNING.degradeNegativeShareAt
  if (signals.reviewCount >= MAKE_GOOD_TUNING.degradeReviewCountAt && allNegative) return true
  if (signals.bursty && allNegative) return true
  return false
}

/**
 * Genuineness band for a row (ALT-349). Precedence:
 *   1. operator_verdict overrides EVERYTHING (the operator saw the review; their
 *      call beats the model AND the reviewer signals).
 *   2. Unscored rows (authenticity_score null) read as "genuine" — innocent
 *      until scored; the fail-soft scoring pass must never make a review look
 *      doubtful just because the model was down.
 *   3. Otherwise the score's band, degraded one band by hostile reviewer signals.
 */
export function genuinenessBand(row: LocationReviewRow, signals?: ReviewerSignals): GenuinenessBand {
  if (row.operator_verdict === "genuine") return "genuine"
  if (row.operator_verdict === "not_genuine") return "suspect"
  let band: GenuinenessBand
  if (row.authenticity_score == null) band = "genuine"
  else if (row.authenticity_score < MAKE_GOOD_TUNING.suspectBelow) band = "suspect"
  else if (row.authenticity_score < MAKE_GOOD_TUNING.cautionBelow) band = "caution"
  else band = "genuine"
  return signalsDegrade(signals) ? degradeOneBand(band) : band
}

/**
 * Severity band for a row (ALT-350). Any red flag is crisis by definition (the
 * deterministic floor in scoring.ts already pushes the score up, but the band
 * must not depend on that). Unscored rows read as "mild" — neutral rendering.
 */
export function severityBandFor(row: LocationReviewRow): SeverityBand {
  if (Array.isArray(row.red_flags) && row.red_flags.length > 0) return "crisis"
  if (row.severity_score == null) return "mild"
  if (row.severity_score >= MAKE_GOOD_TUNING.crisisAt) return "crisis"
  if (row.severity_score >= MAKE_GOOD_TUNING.seriousAt) return "serious"
  return "mild"
}

/** True when the review is negative enough that a make-good could apply at all:
 *  1-2 stars, or unrated but scored into the serious/crisis range. */
function makeGoodEligible(row: LocationReviewRow): boolean {
  if (typeof row.rating === "number") return row.rating <= MAKE_GOOD_TUNING.makeGoodMaxRating
  return row.severity_score != null && row.severity_score >= MAKE_GOOD_TUNING.seriousAt
}

/**
 * Recommended action tier for a review (ALT-352). Recommendation only — the
 * operator executes. Rules, IN ORDER:
 *   1. Red flags or crisis severity -> "respond" + ownerAttention. Crisis
 *      handling stays human; no automated generosity on an illness/safety/
 *      discrimination situation.
 *   2. Doubtful genuineness (suspect OR caution) -> capped at "respond". Never
 *      recommend give-aways on reviews we are not confident reflect a real visit.
 *   3. Positive / non-negative reviews -> "respond" (a thank-you; a glowing
 *      review never needs a make-good).
 *   4. Otherwise generosity_threshold slides the discount/comp cut-points down
 *      from their bases (see MAKE_GOOD_TUNING): 0 = respond-only posture,
 *      100 = generous.
 */
export function recommendMakeGood(
  row: LocationReviewRow,
  opts: { threshold: number; signals?: ReviewerSignals },
): MakeGoodRecommendation {
  const severityBand = severityBandFor(row)
  const hasRedFlags = Array.isArray(row.red_flags) && row.red_flags.length > 0

  // 1. Crisis stays human — the owner responds personally, no offers attached.
  if (hasRedFlags || severityBand === "crisis") {
    return {
      tier: "respond",
      rationale: "This one needs the owner personally: reach out, hear the full story, and make it right directly before offering anything.",
      ownerAttention: true,
    }
  }

  // 2. Doubtful reviews are capped at a reply — generosity waits for confidence.
  const genuineness = genuinenessBand(row, opts.signals)
  if (genuineness === "suspect") {
    return {
      tier: "respond",
      rationale: "Reply politely, but skip any offer: this review shows signs it may not come from a real visit.",
      ownerAttention: false,
    }
  }
  if (genuineness === "caution") {
    return {
      tier: "respond",
      rationale: "Reply warmly, but hold off on offers until you are more confident this reflects a real visit.",
      ownerAttention: false,
    }
  }

  // 3. Positive or non-negative reviews get thanks, never a give-away.
  if (!makeGoodEligible(row)) {
    return {
      tier: "respond",
      rationale: "A warm thank-you reply is all this one needs.",
      ownerAttention: false,
    }
  }

  // 4. Generosity slides the cut-points. Clamped at the "serious" edge so a
  //    make-good is never suggested for mild dissatisfaction, even at 100.
  const threshold = Math.min(100, Math.max(0, opts.threshold))
  const discountAt = Math.max(MAKE_GOOD_TUNING.seriousAt, MAKE_GOOD_TUNING.discountBase - threshold * MAKE_GOOD_TUNING.discountSlope)
  const compAt = Math.max(MAKE_GOOD_TUNING.seriousAt, MAKE_GOOD_TUNING.compBase - threshold * MAKE_GOOD_TUNING.compSlope)
  const severity = row.severity_score ?? 0 // unscored -> respond (neutral posture)

  let tier: MakeGoodTier = "respond"
  if (severity >= compAt) tier = "comp"
  else if (severity >= discountAt) tier = "discount"

  if (tier === "comp") {
    return {
      tier,
      rationale: "This experience was bad enough that a sincere reply plus a comped visit is worth it to win them back.",
      ownerAttention: false,
    }
  }
  if (tier === "discount") {
    return {
      tier,
      rationale: "A sincere reply plus a discount on their next visit is a fair way to make this right.",
      ownerAttention: false,
    }
  }
  return {
    tier,
    rationale: "A sincere, specific reply is the right move here; no offer needed.",
    ownerAttention: false,
  }
}
