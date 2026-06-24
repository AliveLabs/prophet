// ---------------------------------------------------------------------------
// Scoring core (engine rewrite — P2). The single source of truth for how a play
// is ranked. Replaces the old KIND_RANK×10 + CONF_RANK ladder in synthesis.ts
// (which ignored impact and hard-gated by play kind) with ONE continuous,
// weighted, 0-100 combined score across a single global pool.
//
// The model (DECIDED 2026-06-19, full rationale in
// docs/engine-rewrite/insight-engine-phased-plan.md "Scoring model"):
//
//   base     = w_impact·impact + w_confidence·confidence + w_importance·importance
//   combined = base × categoryPrior            (a MODEST bias, never a gate)
//
// Every factor is a WHOLE 0-100. The 0-100 scale is a legible/tunable rescale —
// it is NOT what lets a strong ops play beat a weak marketing play. What does that
// is (a) combining impact + confidence into the base BEFORE the prior, and (b) a
// modest prior gap. (Worked example below.)
//
// EVERY tunable constant lives in this one file so the engine can be calibrated
// from one place as live restaurants generate evidence.
// ---------------------------------------------------------------------------

import type { Category, Confidence, EnrichedRecommendation, Stance } from "@/lib/skills/types"

/** leverage.label — the play's qualitative impact tier (see Leverage in types.ts). */
export type ImpactLabel = "high" | "medium" | "low"

// --- P11 calibration: maintain stance + failure signals ---------------------
//
// A "maintain" play (keep replying to reviews, keep the patio clean) earns its
// impact from RISK-OF-STOPPING, not novelty. Without evidence that the good thing
// is actually slipping — a negative trend, a complaint theme, a competitor
// encroachment ref — a maintain play is capped at LOW impact so it can never
// outrank a real problem. WHERE such a failure signal IS present, the cap lifts
// and the play scores by the size of the risk like any other.

/**
 * Ref-base patterns that mark a FAILURE signal — evidence that something is going wrong
 * (so a maintain play has a real risk-of-stopping to defend against). Matched against the
 * BASE of each evidenceRef (the part before ":"), case-insensitively. SEED — extend as new
 * negative-signal rules ship; matching is substring-based so families like `*_decline_*`
 * or `review.theme` (when negative) are caught by their stem.
 */
export const FAILURE_REF_PATTERNS: readonly string[] = [
  "negative",
  "complaint",
  "decline",
  "drop",
  "loss",
  "churn",
  "encroach",
  "competitor_growth", // e.g. seo_competitor_growth_trend
  "competitor_gain",
  "competitor_overtake", // e.g. seo_competitor_overtake
  "threat", // e.g. seo_competitor_top_page_threat
  "slipping",
  "slow_service",
  // review_velocity is split by direction (lib/insights/rules.ts): only the FALLING cadence is a
  // failure signal. Match it precisely — the old broad "velocity" matched the RISING (good) case too.
  "review_velocity_falling",
  "warning",
  // NOTE: "gap" was removed — it false-positives on OPPORTUNITY refs (seo_keyword_opportunity_gap,
  // social.engagement_gap, menu.category_gap, …), which are upside to seize, not failure signals.
  // "risk" was also dropped (no real failure insight_type carries it; it only invited false matches).
] as const

/** The impact a `maintain` play is capped to ABSENT a failure signal (low). Tunable. */
export const MAINTAIN_IMPACT_CAP: ImpactLabel = "low"

// --- Factor → 0-100 normalizations ------------------------------------------

/** Confidence tier → 0-100. SEED — calibrate across live restaurants. */
export const CONFIDENCE_SCORE: Record<Confidence, number> = {
  high: 100,
  medium: 65,
  directional: 30,
}

/** Impact (leverage.label) tier → 0-100. SEED. */
export const IMPACT_SCORE: Record<ImpactLabel, number> = {
  high: 100,
  medium: 60,
  low: 25,
}

/**
 * Impact used when a play carries NO sized leverage. Model-parsed plays may omit
 * leverage entirely (coerceEnrichedPlays leaves it undefined), and every
 * deterministic fallback already sets it to "medium" — so an unsized play scores
 * as medium rather than being buried at "low". Tunable.
 */
export const IMPACT_DEFAULT = IMPACT_SCORE.medium

/**
 * Importance is the third base factor. NO play emits a per-play importance signal
 * yet (P2), so it is a NEUTRAL constant: it adds an identical amount to every play
 * and therefore does NOT affect ranking today. The weighted slot exists so a later
 * phase can wire a real, evidence-grounded importance (corroboration strength,
 * time-sensitivity, …) WITHOUT touching this formula or the priors.
 *
 * ⚠️ OPEN FOR BRYAN: confirm importance should stay neutral for now, or whether it
 * should derive from an evidence signal. It is deliberately NOT derived from RecKind/
 * Category — that would double-count the bias the category prior already applies.
 */
export const IMPORTANCE_NEUTRAL = 50

/** Base-factor weights. SEED: impact leads, then confidence, then importance. */
export const FACTOR_WEIGHTS = {
  impact: 0.4,
  confidence: 0.35,
  importance: 0.25,
} as const

/**
 * Per-category priors — a MODEST domain bias applied AFTER the base, never a gate.
 * Operations is biased down (an ops play must out-earn the gap to lead) but is NOT
 * floored/capped: a high-confidence, high-impact ops play still wins a quiet week.
 * SEED — INSTRUMENTED via the prior-flip log in synthesis; calibrate from evidence.
 */
export const CATEGORY_PRIORS: Record<Category, number> = {
  demand: 1.0,
  marketing: 1.0,
  // P12: social counter-strategy (the social-counter producer) is its OWN domain, split from
  // marketing (own-content cadence) so the operator sees a distinct competitive-social lens and
  // can rerank it. NEUTRAL prior — same calibrate-from-evidence stance as menu/grassroots; a
  // cited-competitor-post counter-play competes on merit, no thumb on the scale before we have data.
  social: 1.0,
  // P6: menu / food-pairing plays (the kitchen expert) compete on merit — NEUTRAL prior, like
  // demand/marketing. We start narrow and earn any bias from instrumented evidence rather than
  // asserting it (the calibration principle). A "feature the short rib this cold snap" play is a
  // revenue-capture move; no reason to thumb the scale up or down before we have data.
  menu: 1.0,
  // P6: grassroots / guerrilla marketing (zero-budget hyper-local hustle) is its OWN domain, split
  // from marketing (digital/social) so the operator sees two distinct lenses and synthesis can tell
  // the plays apart. Neutral prior — same calibrate-from-evidence stance as menu.
  grassroots: 1.0,
  positioning: 0.95,
  reputation: 0.92,
  operations: 0.85,
  // Cross-domain convergence plays (P5) compete on merit — neutral prior, earn the bias from
  // evidence rather than asserting it (the plan's "small boost? default no"). Their multi-source
  // grounding + Opus depth should let them score on impact/confidence without a thumb on the scale.
  convergence: 1.0,
}

/** Prior used defensively if a play's category can't be resolved (neutral, no bias). */
export const NEUTRAL_PRIOR = 1.0

// --- P15: play-type feedback multiplier (Learning Spine L1) ------------------
//
// A SECOND, gentler multiplier applied ALONGSIDE the category prior in synthesis:
//   combined = base × categoryPrior × playTypeMultiplier
// It is derived from the distilled click-feedback rollup (skill_feedback_rollup), keyed by the
// stable play_type_key. It only NUDGES rank — per-location brand_tolerance + the operator's
// category-priors stay DOMINANT (the clamp below is deliberately tighter-feeling than the prior
// range so a feedback nudge can't invert a tolerance/category signal).
//
// Every tunable for the multiplier lives HERE (the "one tunables file" invariant). The BAND that
// maps actions → signal weight/confidence is the OTHER tuning surface and lives in feedback-signals.ts
// (action semantics), kept separate on purpose: this file tunes how MUCH a distilled signal moves
// rank; that file tunes WHICH actions count and how strongly. The rollup math (feedback-rollup.ts)
// references these and never hard-codes them.

/** Neutral multiplier — applied when there is no qualifying rollup (absent table, below support_n,
 *  low confidence). The FLOOR: an empty rollup ⇒ every play multiplied by 1.0 ⇒ ranking is
 *  byte-identical to today. */
export const PLAY_TYPE_MULTIPLIER_NEUTRAL = 1.0

/** The clamp on the feedback multiplier — a MODEST reweight, never a gate (matches the P10 0.7–1.3
 *  decision in §6/§7). A strongly-disliked play-type bottoms at 0.7; a strongly-liked one tops at 1.3. */
export const PLAY_TYPE_MULTIPLIER_MIN = 0.7
export const PLAY_TYPE_MULTIPLIER_MAX = 1.3

/** Minimum effective support (band-weighted count of feedback rows) before a rollup row is allowed to
 *  move ranking at all. Below this, the multiplier is forced to NEUTRAL — one operator rage-clicking a
 *  handful of times cannot move the engine (guardrail §2.2(a)). Tunable. */
export const PLAY_TYPE_MIN_SUPPORT_N = 8

/** Minimum self-trust before a rollup row counts: the rollup's aggregate confidence (the band's
 *  confidence, support-weighted) must be >= this or the multiplier is forced NEUTRAL. The spec's
 *  "confidence < 0.5 → zero weight → multiplier 1.0" guard. Tunable. */
export const PLAY_TYPE_MIN_CONFIDENCE = 0.5

/** Beta-Binomial smoothing prior (pseudo-counts) for the liked-rate. A symmetric prior centered at
 *  0.5 means a row with little data smooths toward "neutral" (bayes_score ≈ 0.5 ⇒ multiplier ≈ 1.0),
 *  so small samples can't swing the multiplier. Higher α=β ⇒ more smoothing / more data needed to move.
 *  Tunable. */
export const PLAY_TYPE_SMOOTHING_PRIOR = { alpha: 4, beta: 4 } as const

/**
 * Map a smoothed liked-rate (bayes_score, 0..1) onto the clamped multiplier range. 0.5 (neutral) →
 * 1.0; 1.0 (all liked) → MAX; 0.0 (all disliked) → MIN. Linear around the neutral midpoint, then
 * clamped. Pure — the single definition of how a liked-rate becomes a nudge.
 */
export function multiplierFromBayesScore(bayesScore: number): number {
  const s = Number.isFinite(bayesScore) ? Math.max(0, Math.min(1, bayesScore)) : 0.5
  const span = s >= 0.5 ? PLAY_TYPE_MULTIPLIER_MAX - 1.0 : 1.0 - PLAY_TYPE_MULTIPLIER_MIN
  const raw = 1.0 + (s - 0.5) * 2 * span
  return Math.max(PLAY_TYPE_MULTIPLIER_MIN, Math.min(PLAY_TYPE_MULTIPLIER_MAX, raw))
}

// --- Scoring ----------------------------------------------------------------

export type ScoreInput = {
  confidence: Confidence
  /** leverage.label; undefined → IMPACT_DEFAULT (treated as medium). */
  impact?: ImpactLabel
  /** 0-100; undefined → IMPORTANCE_NEUTRAL. */
  importance?: number
  category: Category
  /**
   * P11: the play's operator intent. A `maintain` play with NO failure signal is capped at
   * MAINTAIN_IMPACT_CAP before scoring (risk-of-stopping, not novelty). Undefined → `capture`
   * (no cap — prior behavior).
   */
  stance?: Stance
  /** P11: true when this play cites a failure signal (negative trend / complaint / encroachment),
   *  which lifts the maintain cap. Undefined/false → cap applies to maintain plays. */
  hasFailureSignal?: boolean
  /**
   * P15: the distilled click-feedback multiplier for this play's play_type_key, applied as a THIRD
   * clamped factor ALONGSIDE the category prior: combined = base × categoryPrior × playTypeMultiplier.
   * Already clamped to [0.7, 1.3] by the rollup; undefined → PLAY_TYPE_MULTIPLIER_NEUTRAL (1.0) so an
   * absent/empty rollup leaves the score identical to today. It only NUDGES — per-location
   * brand_tolerance + the operator's category priors stay DOMINANT.
   */
  playTypeMultiplier?: number
}

/** Does any of a play's evidenceRefs match a FAILURE_REF_PATTERN? Case-insensitive, matched against
 *  the WHOLE ref (base + field suffix) so a negative-signal FIELD like `review.theme:negative_sentiment`
 *  or `..._TREND:PCT_DECLINE` is caught even when the rule's base name is neutral. */
export function hasFailureSignal(refs: readonly string[] | undefined): boolean {
  if (!refs?.length) return false
  return refs.some((ref) => {
    const r = ref.toLowerCase()
    return FAILURE_REF_PATTERNS.some((p) => r.includes(p))
  })
}

/**
 * P11: the effective impact a play is scored on, after the maintain-stance calibration.
 * A `maintain` play with no failure signal is forced to MAINTAIN_IMPACT_CAP (low) so a
 * best-practice habit can't outrank a real problem; everything else keeps its declared impact.
 */
export function calibratedImpact(input: ScoreInput): ImpactLabel | undefined {
  if (input.stance === "maintain" && !input.hasFailureSignal) return MAINTAIN_IMPACT_CAP
  return input.impact
}

/** Pure weighted base from three already-normalized 0-100 factors. */
export function weightedBase(factors: { impact: number; confidence: number; importance: number }): number {
  return (
    FACTOR_WEIGHTS.impact * factors.impact +
    FACTOR_WEIGHTS.confidence * factors.confidence +
    FACTOR_WEIGHTS.importance * factors.importance
  )
}

/** The base score (pre-prior) for a play, mapping its enum factors to 0-100. The impact factor
 *  is the CALIBRATED impact (P11), so a maintain play with no failure signal is capped at low. */
export function computeBaseScore(input: ScoreInput): number {
  const impact = calibratedImpact(input)
  return weightedBase({
    impact: impact ? IMPACT_SCORE[impact] : IMPACT_DEFAULT,
    confidence: CONFIDENCE_SCORE[input.confidence],
    importance: input.importance ?? IMPORTANCE_NEUTRAL,
  })
}

/** Convenience: build the calibration-relevant ScoreInput fields from a play (stance + failure
 *  signal derived from its evidenceRefs). Used by synthesis' toScoreInput so the scoring core
 *  stays the single source of truth for the maintain cap. */
export function calibrationOf(play: Pick<EnrichedRecommendation, "stance" | "evidenceRefs">): {
  stance?: Stance
  hasFailureSignal: boolean
} {
  return { stance: play.stance, hasFailureSignal: hasFailureSignal(play.evidenceRefs) }
}

/** The play-type feedback multiplier for a ScoreInput, defensively clamped + defaulted to neutral.
 *  Single definition so ranking + scoring + fusion all apply the SAME factor (P15). */
export function effectivePlayTypeMultiplier(input: ScoreInput): number {
  const m = input.playTypeMultiplier
  if (typeof m !== "number" || !Number.isFinite(m)) return PLAY_TYPE_MULTIPLIER_NEUTRAL
  return Math.max(PLAY_TYPE_MULTIPLIER_MIN, Math.min(PLAY_TYPE_MULTIPLIER_MAX, m))
}

/**
 * The combined 0-100 score: base × the category's modest prior × the play-type feedback multiplier
 * (P15), as a whole number. `priors` defaults to the global CATEGORY_PRIORS; pass a per-location
 * override (P8) to rank with operator-tuned category weights. The feedback multiplier is a SECOND,
 * gentler factor — clamped to [0.7,1.3] and defaulting to 1.0 — so an empty rollup is a no-op and the
 * category prior + brand_tolerance stay dominant.
 */
export function computeCombinedScore(
  input: ScoreInput,
  priors: Record<Category, number> = CATEGORY_PRIORS,
): number {
  const prior = priors[input.category] ?? NEUTRAL_PRIOR
  return Math.round(computeBaseScore(input) * prior * effectivePlayTypeMultiplier(input))
}

// --- Ranking ----------------------------------------------------------------
//
// One global pool, ranked best-first by combined score. Ties are broken
// deterministically: higher confidence first, then ORIGINAL input order (so the
// sort is stable and reproducible — the plan's "stable sort + tie-breaking").

type Scored<T> = { item: T; index: number; base: number; combined: number; confidence: number }

/** Sort scored plays best-first by one raw score, tie-broken by confidence then input order. */
function sortByScore<T>(scored: Scored<T>[], key: "base" | "combined"): Scored<T>[] {
  return [...scored].sort(
    (a, b) =>
      b[key] - a[key] || // higher score first
      b.confidence - a.confidence || // then stronger confidence
      a.index - b.index, // then stable (original order)
  )
}

export type RankResult<T> = {
  /** Items best-first by combined score, with each item's whole-number score. */
  ranked: Array<{ item: T; score: number }>
  /**
   * True when applying the category priors reordered the pool relative to ranking
   * on the base alone — i.e. a prior actually changed the outcome. Instrumented so
   * we can see how often (and where) the domain bias bites, and tune from evidence.
   */
  priorFlipped: boolean
}

/**
 * Rank a pool by combined score and report whether the priors changed the order.
 * `priors` defaults to the global CATEGORY_PRIORS; pass a per-location override (P8)
 * to rank with operator-tuned category weights.
 */
export function rankPlays<T>(
  items: T[],
  toInput: (item: T) => ScoreInput,
  priors: Record<Category, number> = CATEGORY_PRIORS,
): RankResult<T> {
  // Score each play ONCE on RAW (unrounded) values. Both the ordering and the prior-flip
  // comparison run on the raw scores, so integer rounding can never collapse two distinct
  // scores into a spurious tie — keeping the flip telemetry trustworthy even once a real
  // per-play importance signal is wired in (today importance is a neutral constant). The
  // emitted score is rounded only for display.
  const scored: Scored<T>[] = items.map((item, index) => {
    const input = toInput(item)
    const base = computeBaseScore(input)
    const prior = priors[input.category] ?? NEUTRAL_PRIOR
    // P15: the play-type feedback multiplier rides alongside the category prior. Default 1.0 (empty
    // rollup) ⇒ combined == base × prior, byte-identical to pre-P15 ranking. priorFlipped continues
    // to measure ONLY the category prior's effect (base vs base×prior), so the feedback nudge does
    // not pollute the prior-flip telemetry.
    const feedback = effectivePlayTypeMultiplier(input)
    return { item, index, base, combined: base * prior * feedback, confidence: CONFIDENCE_SCORE[input.confidence] }
  })

  const byCombined = sortByScore(scored, "combined")
  const byBase = sortByScore(scored, "base")
  const priorFlipped = byCombined.some((s, i) => s.item !== byBase[i].item)

  return {
    ranked: byCombined.map((s) => ({ item: s.item, score: Math.round(s.combined) })),
    priorFlipped,
  }
}
