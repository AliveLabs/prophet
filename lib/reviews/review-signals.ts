// ---------------------------------------------------------------------------
// Review Intelligence (ALT-355) — THE REVIEW-TRIAGE SIGNAL BAND.
//
// A miniature of lib/skills/feedback-signals.ts for the /reviews triage
// actions: every operator action maps to ONE normalized signal
// `{ polarity, weight, confidence }`, and retuning an action is an EDIT TO
// THIS MAP, never a rewrite of a consumer.
//
// ★ CAPTURED FOR FUTURE LEARNING ONLY (see DECISIONS D5). ★
// These signals are NOT consumed by lib/skills/feedback-rollup.ts and do NOT
// feed the FEEDBACK_SIGNAL_MAP band weights yet — the same hard constraint the
// migration puts on the triage columns. Today the actions only drive triage
// state + display (a verdict flips the genuineness band immediately via
// make-good.ts). When a consumer lands, it reads signalForReviewAction() —
// never a raw action name — so wiring it up is a consumer change plus, at
// most, a retune of this map.
//
// THE SIGNAL DICTIONARY (same semantics as the brief band):
//   - polarity   : -1 | 0 | 1 — was the model's read on this review wrong (-1),
//                  neutral (0), or right/valuable (1), per the operator.
//   - weight     : >= 0 — how much one row of this action should move counts.
//   - confidence : 0..1 — how much we trust the action as a genuine signal.
//                  Verdicts are EXPLICIT calls -> high; triage housekeeping
//                  (responded/dismissed) is AMBIGUOUS -> low or none.
// ---------------------------------------------------------------------------

/**
 * Every triage action the /reviews surface can capture. This union is the ONLY
 * place the action names live as identifiers — any future consumer keys off the
 * normalized signal, not these strings.
 *
 * - verdict_genuine / verdict_not_genuine : the operator's EXPLICIT genuineness
 *   call (location_reviews.operator_verdict). The strongest review signal.
 * - marked_responded : the operator responded — a mild "this was worth acting
 *   on" lean, well below a verdict.
 * - dismissed : visibility housekeeping only. Ambiguous by design (handled
 *   elsewhere, not worth a reply, or just tidying) -> zero learning weight.
 */
export type ReviewTriageAction = "marked_responded" | "dismissed" | "verdict_genuine" | "verdict_not_genuine"

/** The normalized signal a single triage action contributes (provisional weights). */
export type ReviewTriageSignal = {
  /** -1 model read it wrong · 0 neutral · 1 model read it right / review mattered. */
  polarity: -1 | 0 | 1
  /** >= 0. Verdicts are full-weight; housekeeping actions are fractional or zero. */
  weight: number
  /** 0..1. Explicit verdicts are high; ambiguous triage actions are low or zero. */
  confidence: number
}

/**
 * ★ THE BAND ★ — provisional values (nothing consumes them yet; see the header).
 * Retuning = edit these numbers. Nothing downstream changes.
 */
export const REVIEW_SIGNAL_MAP: Record<ReviewTriageAction, ReviewTriageSignal> = {
  // ── VERDICTS: explicit operator calls on genuineness. High confidence, full weight. ──
  verdict_genuine: { polarity: 1, weight: 1, confidence: 0.9 },
  verdict_not_genuine: { polarity: -1, weight: 1, confidence: 0.9 },

  // ── RESPONDED: mild positive engagement (the review was worth acting on). ──
  marked_responded: { polarity: 1, weight: 0.3, confidence: 0.5 },

  // ── DISMISSED: visibility only — ambiguous, zero learning weight (same posture
  //    as the brief band's bare Remove). ──
  dismissed: { polarity: 0, weight: 0, confidence: 0 },
}

/**
 * Pure accessor for the band. Any future consumer uses ONLY this — never
 * REVIEW_SIGNAL_MAP[raw] directly — so an unknown/legacy action degrades to a
 * true no-op signal instead of throwing.
 */
export function signalForReviewAction(action: string): ReviewTriageSignal {
  const known = (REVIEW_SIGNAL_MAP as Record<string, ReviewTriageSignal | undefined>)[action]
  return known ?? { polarity: 0, weight: 0, confidence: 0 }
}
