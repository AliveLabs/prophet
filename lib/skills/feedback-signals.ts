// ---------------------------------------------------------------------------
// Learning Spine L1 (P15) — THE FEEDBACK-SIGNAL BAND.
//
// ★ THIS FILE IS THE SINGLE TUNING POINT FOR THE CLICK-FEEDBACK STREAM. ★
//
// The learning loop consumes EVERY feedback action through ONE abstraction: a map from a raw
// product action to a normalized signal `{ polarity, weight, confidence }`. The rollup, the
// Bayesian smoothing, the small-N guard, and the synthesis multiplier are ALL written against
// this normalized signal — they NEVER reference a raw action name (`thumbs_up`, `dismissed`, …).
//
// WHY THE ABSTRACTION (Bryan's explicit, delegated design call):
//   Bryan has a STANDING INTENT to revisit whether dismiss / snooze / save are the right actions
//   and whether they serve the customer. So the system MUST be built so that REDEFINING, ADDING,
//   or REMOVING an action is a RETUNE OF THIS MAP — a one-line edit to FEEDBACK_SIGNAL_MAP — and
//   NEVER a rewrite of the rollup or scoring logic. Proof of the retune-not-rewrite property:
//     - To DROP an action's influence: set its weight to 0 (or confidence below the support gate).
//       Nothing downstream changes; the rollup math simply contributes 0 for that action.
//     - To ADD an action: add one entry here (+ a capture surface routes its rows in). The rollup
//       reads it via signalFor() with no new branch.
//     - To FLIP/REWEIGHT an action: change its polarity/weight/confidence here. The engine is blind
//       to the change beyond the numbers this map yields.
//   feedback-rollup.test.ts asserts this: a retuned map changes the rollup output WITHOUT any edit
//   to feedback-rollup.ts.
//
// THE SIGNAL DICTIONARY (what the three fields mean):
//   - polarity   : -1 | 0 | 1  — the DIRECTION of the signal (disliked / neutral / liked).
//   - weight     : >= 0         — how MUCH one row of this action moves the liked/disliked counts.
//                                  Thumbs are full-weight (1.0); directional actions are fractional.
//   - confidence : 0..1         — how much we TRUST this action as a genuine quality signal. Thumbs
//                                  are an EXPLICIT verdict → high confidence. save/snooze/dismiss are
//                                  AMBIGUOUS (a dismiss may mean "not now", not "bad") → low confidence.
//                                  The rollup multiplies weight × confidence, so a low-confidence
//                                  action both moves the counts less AND is easier to swamp by the
//                                  small-N guard. confidence is also where Bryan dials an action down
//                                  to "observe only" without removing it (set it below the support gate).
//
// SIGNAL TIERS (the band guidance — get this RIGHT):
//   - THUMBS UP / DOWN  → the STRONG, STABLE, EXPLICIT PRIMARY signal (HIGH confidence ±). It ALREADY
//     EXISTS in the product (brief_feedback writes via preferences.ts), so this stream is LIVE, not
//     dark. These are the backbone of the rollup.
//   - SAVE              → POSITIVE, LOW-confidence DIRECTIONAL signal (a save is interest, but it's
//     not an explicit "this is a good recommendation").
//   - DISMISS           → NEGATIVE, LOW-confidence DIRECTIONAL signal (a dismiss may mean "bad" OR
//     just "not for me right now" — ambiguous, so low confidence).
//   - SNOOZE            → MILD-NEGATIVE, VERY-LOW-confidence DIRECTIONAL signal (the weakest read:
//     "later", barely a quality judgment at all).
//
// ⚠️ PROVISIONAL WEIGHTS: the save/snooze/dismiss numbers below are DIRECTIONAL PLACEHOLDERS pending
// Bryan's action-semantics review (do these actions serve the customer? are they the right actions?).
// They are intentionally conservative so the directional stream can only NUDGE, never dominate the
// thumbs. Retune here when that review lands — nothing else changes.
// ---------------------------------------------------------------------------

/**
 * Every raw feedback action the product can capture. This union is the ONLY place action names live
 * as identifiers — downstream code keys off the normalized signal, not these strings.
 *
 * - thumbs_up / thumbs_down : the EXPLICIT primary signal (brief_feedback.verdict good|bad).
 * - saved / snoozed / dismissed : the directional play_actions (app/(dashboard)/home/brief-actions.ts).
 *
 * To add an action: extend this union + add one FEEDBACK_SIGNAL_MAP entry + route its rows in the
 * capture/rollup read. To stop consuming one: drop its map weight to 0 (keep the entry for clarity).
 */
export type FeedbackAction = "thumbs_up" | "thumbs_down" | "saved" | "snoozed" | "dismissed"

/** The normalized signal a single action contributes. Polarity is the direction; weight is how much
 *  one row moves the counts; confidence is how much we trust the action as a quality signal. */
export type FeedbackSignal = {
  /** -1 disliked · 0 neutral · 1 liked. */
  polarity: -1 | 0 | 1
  /** >= 0. Full-weight thumbs = 1.0; directional actions are fractional placeholders. */
  weight: number
  /** 0..1. Thumbs are an explicit verdict (high); save/snooze/dismiss are ambiguous (low). */
  confidence: number
}

/**
 * ★ THE BAND ★ — the single tuning point. Retuning ANY value here re-tunes the whole learning loop;
 * the rollup + scoring never change. (See the file header for the retune-not-rewrite proof.)
 */
export const FEEDBACK_SIGNAL_MAP: Record<FeedbackAction, FeedbackSignal> = {
  // ── PRIMARY: explicit thumbs. High confidence, full weight, clear polarity. The backbone. ────────
  thumbs_up: { polarity: 1, weight: 1.0, confidence: 0.95 },
  thumbs_down: { polarity: -1, weight: 1.0, confidence: 0.95 },

  // ── DIRECTIONAL (PROVISIONAL — pending Bryan's action-semantics review): save/snooze/dismiss. ────
  // A SAVE is a positive lean, but not an explicit "good rec" → low confidence, partial weight.
  saved: { polarity: 1, weight: 0.5, confidence: 0.4 },
  // A DISMISS leans negative, but is ambiguous ("not for me" vs "bad") → low confidence.
  dismissed: { polarity: -1, weight: 0.5, confidence: 0.4 },
  // A SNOOZE is the weakest read ("later") → mild-negative, very-low confidence, small weight.
  snoozed: { polarity: -1, weight: 0.25, confidence: 0.2 },
}

/**
 * Pure accessor for the band. The rollup uses ONLY this — never FEEDBACK_SIGNAL_MAP[raw] directly —
 * so an unknown/legacy action degrades to a true no-op signal (weight 0, confidence 0) instead of
 * throwing or polluting the rollup. Adding a new action is then a map edit + a capture route; this
 * accessor and every downstream consumer are untouched.
 */
export function signalFor(action: string): FeedbackSignal {
  const known = (FEEDBACK_SIGNAL_MAP as Record<string, FeedbackSignal | undefined>)[action]
  // Unknown action → neutral no-op (never throws): the engine stays isolated from action semantics.
  return known ?? { polarity: 0, weight: 0, confidence: 0 }
}

/**
 * The legacy brief_feedback verdict (good|bad) mapped onto a band action, so the EXISTING thumbs
 * writes (preferences.ts) flow through the SAME band as save/snooze/dismiss. This is the one place
 * the verdict→action translation lives; the rollup then treats every signal uniformly.
 */
export function actionForVerdict(verdict: "good" | "bad"): FeedbackAction {
  return verdict === "good" ? "thumbs_up" : "thumbs_down"
}
