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
  Remediation,
  ReviewerSignals,
  SentimentBand,
  SeverityBand,
} from "@/lib/reviews/types"

/** Default locations.generosity_threshold for orgs that never touched the slider.
 *  Bryan 2026-07-17 (DECISIONS D2): right down the middle. */
export const GENEROSITY_DEFAULT = 50

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
  // The generosity frame (ALT-361). Slider bands map 1:1 to behavior:
  //   <= respondOnlyMax ("Respond first")  -> no offers, ever
  //   34-66 ("Measured make-goods")        -> gestures on genuinely serious complaints
  //   67+  ("Generous")                    -> the refund rung becomes reachable
  // offerAt = where gestures start; fullAt = where the top rung starts; the
  // three lower rungs split [offerAt, fullAt) evenly.
  respondOnlyMax: 33,
  offerBase: 70,
  offerSlope: 0.6,
  fullBase: 95,
  fullSlope: 0.25,
  makeGoodMaxRating: 2,
  degradeReviewCountAt: 2,
  degradeNegativeShareAt: 0.99,
  // Sentiment display/sort bands (ALT-359): below negativeBelow = negative,
  // above positiveAbove = positive, between = neutral. The gold zone on the
  // spectrum deliberately extends a little below neutral (Bryan 2026-07-17).
  sentimentNegativeBelow: -15,
  sentimentPositiveAbove: 35,
} as const

/** Star-anchored sentiment fallback for rows the model hasn't read (no text /
 *  not yet scored): the marker still plots somewhere honest. */
const STAR_SENTIMENT: Record<number, number> = { 1: -70, 2: -45, 3: 0, 4: 50, 5: 75 }

/** Sentiment position for the spectrum marker: the model's read when scored,
 *  else the star anchor, else dead neutral. */
export function sentimentValueFor(row: LocationReviewRow): number {
  if (typeof row.sentiment_score === "number") return row.sentiment_score
  if (typeof row.rating === "number" && STAR_SENTIMENT[row.rating] !== undefined) return STAR_SENTIMENT[row.rating]
  return 0
}

/** Display/sort band from sentiment (crisis routing stays on red flags/severity). */
export function sentimentBandFor(row: LocationReviewRow): SentimentBand {
  const v = sentimentValueFor(row)
  if (v < MAKE_GOOD_TUNING.sentimentNegativeBelow) return "negative"
  if (v > MAKE_GOOD_TUNING.sentimentPositiveAbove) return "positive"
  return "neutral"
}

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

/** The make-good ladder, least to most generous. Index = "rung". */
const LADDER: readonly Remediation[] = ["none", "replace_side", "treat", "replace_meal", "refund_and_replace"]

/** Tag tier from the concrete remediation (keeps the card's tag vocabulary stable). */
function tierFor(remediation: Remediation): MakeGoodTier {
  if (remediation === "none") return "respond"
  if (remediation === "replace_side" || remediation === "treat") return "discount"
  return "comp"
}

/** Operator-facing description of each rung (also used to build rationales). */
export const REMEDIATION_LABEL: Record<Remediation, string> = {
  none: "no offer",
  replace_side: "replace the side or item that missed",
  treat: "a free dessert or appetizer on their next visit",
  replace_meal: "replace their meal",
  refund_and_replace: "refund the order and replace their meal",
}

/**
 * Recommended action for a review (ALT-352, reshaped by ALT-361). The output is
 * a concrete MAKE-GOOD RUNG (plus the tag tier derived from it). Recommendation
 * only — the operator executes. Rules, IN ORDER:
 *   1. Red flags or crisis severity -> ownerAttention, no rung. Crisis handling
 *      stays human; no automated generosity on an illness/safety/discrimination
 *      situation.
 *   2. Suspect genuineness (bot-like / abusive / operator-flagged) -> measured
 *      reply, no rung. You cannot buy back someone who was never a customer.
 *   3. Positive / non-negative reviews -> warm thanks, no rung.
 *   4. Otherwise severity picks the rung, with generosity_threshold sliding the
 *      cut-points down from their bases (0 = respond-only posture, 100 =
 *      generous), and CAUTION genuineness drops the rung ONE step (Bryan
 *      2026-07-17: the serial complainer might get their meal replaced, they do
 *      not get a refund — doubt shrinks the offer, it does not erase the reply).
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
      remediation: "none",
      rationale: "This one needs the owner personally: reach out, hear the full story, and make it right directly before offering anything.",
      ownerAttention: true,
    }
  }

  // 2. Suspect reviews get a measured reply and nothing else.
  const genuineness = genuinenessBand(row, opts.signals)
  if (genuineness === "suspect") {
    return {
      tier: "respond",
      remediation: "none",
      rationale: "Reply politely, but skip any offer: this review shows signs it may not come from a real visit.",
      ownerAttention: false,
    }
  }

  // 3. Positive or non-negative reviews get thanks, never a give-away.
  if (!makeGoodEligible(row)) {
    return {
      tier: "respond",
      remediation: "none",
      rationale: "A warm thank-you reply is all this one needs.",
      ownerAttention: false,
    }
  }

  // 4. Severity picks the rung; generosity slides the frame; caution drops one
  //    rung. The "Respond first" slider band offers nothing by definition, and
  //    everything is clamped at the "serious" edge so a make-good is never
  //    suggested for mild dissatisfaction, even at 100.
  const threshold = Math.min(100, Math.max(0, opts.threshold))
  const severity = row.severity_score ?? 0 // unscored -> reply only (neutral posture)

  let rung = 0
  if (threshold > MAKE_GOOD_TUNING.respondOnlyMax) {
    const offerAt = Math.max(MAKE_GOOD_TUNING.seriousAt, MAKE_GOOD_TUNING.offerBase - threshold * MAKE_GOOD_TUNING.offerSlope)
    const fullAt = Math.max(offerAt + 8, MAKE_GOOD_TUNING.fullBase - threshold * MAKE_GOOD_TUNING.fullSlope)
    const step = (fullAt - offerAt) / 3
    if (severity >= fullAt) rung = 4
    else if (severity >= offerAt + 2 * step) rung = 3
    else if (severity >= offerAt + step) rung = 2
    else if (severity >= offerAt) rung = 1
  }

  const cautioned = genuineness === "caution" && rung > 0
  if (cautioned) rung -= 1

  const remediation = LADDER[rung]
  const tier = tierFor(remediation)
  const rationale =
    remediation === "none"
      ? cautioned
        ? "Reply warmly and hear them out; hold the offer until you are more confident this reflects a real visit."
        : "A sincere, specific reply is the right move here; no offer needed."
      : cautioned
        ? `Reply with care and offer to ${REMEDIATION_LABEL[remediation]}; this reviewer's pattern says keep the gesture modest.`
        : `A sincere reply plus an offer to ${REMEDIATION_LABEL[remediation]} is a fair way to make this right.`

  return { tier, remediation, rationale, ownerAttention: false }
}
