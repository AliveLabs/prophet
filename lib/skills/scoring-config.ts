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

import type { Category, Confidence } from "@/lib/skills/types"

/** leverage.label — the play's qualitative impact tier (see Leverage in types.ts). */
export type ImpactLabel = "high" | "medium" | "low"

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
  positioning: 0.95,
  reputation: 0.92,
  operations: 0.85,
}

/** Prior used defensively if a play's category can't be resolved (neutral, no bias). */
export const NEUTRAL_PRIOR = 1.0

// --- Scoring ----------------------------------------------------------------

export type ScoreInput = {
  confidence: Confidence
  /** leverage.label; undefined → IMPACT_DEFAULT (treated as medium). */
  impact?: ImpactLabel
  /** 0-100; undefined → IMPORTANCE_NEUTRAL. */
  importance?: number
  category: Category
}

/** Pure weighted base from three already-normalized 0-100 factors. */
export function weightedBase(factors: { impact: number; confidence: number; importance: number }): number {
  return (
    FACTOR_WEIGHTS.impact * factors.impact +
    FACTOR_WEIGHTS.confidence * factors.confidence +
    FACTOR_WEIGHTS.importance * factors.importance
  )
}

/** The base score (pre-prior) for a play, mapping its enum factors to 0-100. */
export function computeBaseScore(input: ScoreInput): number {
  return weightedBase({
    impact: input.impact ? IMPACT_SCORE[input.impact] : IMPACT_DEFAULT,
    confidence: CONFIDENCE_SCORE[input.confidence],
    importance: input.importance ?? IMPORTANCE_NEUTRAL,
  })
}

/** The combined 0-100 score: base × the category's modest prior, as a whole number. */
export function computeCombinedScore(input: ScoreInput): number {
  const prior = CATEGORY_PRIORS[input.category] ?? NEUTRAL_PRIOR
  return Math.round(computeBaseScore(input) * prior)
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

/** Rank a pool by combined score and report whether the priors changed the order. */
export function rankPlays<T>(items: T[], toInput: (item: T) => ScoreInput): RankResult<T> {
  // Score each play ONCE on RAW (unrounded) values. Both the ordering and the prior-flip
  // comparison run on the raw scores, so integer rounding can never collapse two distinct
  // scores into a spurious tie — keeping the flip telemetry trustworthy even once a real
  // per-play importance signal is wired in (today importance is a neutral constant). The
  // emitted score is rounded only for display.
  const scored: Scored<T>[] = items.map((item, index) => {
    const input = toInput(item)
    const base = computeBaseScore(input)
    const prior = CATEGORY_PRIORS[input.category] ?? NEUTRAL_PRIOR
    return { item, index, base, combined: base * prior, confidence: CONFIDENCE_SCORE[input.confidence] }
  })

  const byCombined = sortByScore(scored, "combined")
  const byBase = sortByScore(scored, "base")
  const priorFlipped = byCombined.some((s, i) => s.item !== byBase[i].item)

  return {
    ranked: byCombined.map((s) => ({ item: s.item, score: Math.round(s.combined) })),
    priorFlipped,
  }
}
