// ---------------------------------------------------------------------------
// Learning Spine L1 (P15) — PIPELINE 2 WEEKLY: distill strong, stable feedback patterns into
// skill_knowledge `feedback_pattern` rows (reusing P14's skill_knowledge table + its candidate→active
// promotion). The NIGHTLY rollup (feedback-rollup.ts) is the cheap deterministic signal; this WEEKLY
// pass turns only the STRONGEST, most STABLE rollup rows into a durable prompt-injectable learning
// ("across N locations, drive-thru photo-capture plays are disliked → bias creative toward lobby/expo").
//
// GUARDRAILS (§2.2), all enforced BEFORE a pattern distills:
//   (a) min support_n  — a row must clear DISTILL_MIN_SUPPORT_N (well above the scoring gate) so a
//                        handful of clicks can't mint a learning.
//   (b) severity-aware — only patterns that hold across >= 2 severity bands distill (a dislike that
//                        only shows up at sev-3 is "too wild", not "this play-type is bad").
//   (c) confounder     — a GLOBAL-scope feedback_pattern requires multi-org support (org_support_n);
//                        else the candidate is written at org/location scope.
// Output rows are `candidate` (or `shadow`) — NEVER auto-active for the negative direction without
// review (a strong dislike is the conservative case). They ride the EXACT P14 skill_knowledge schema,
// so the existing loader injects them once promoted and RETIRE/ROLLBACK is a status flip (deploy-free).
//
// This module is the DISTILL POLICY (pure + deterministic). The weekly cron wires the reads/writes.
// No LLM call is required for the deterministic policy below; a model may LATER rewrite the snippet
// prose, but the GATING is pure so it unit-tests without a transport.
// ---------------------------------------------------------------------------

import type { RollupScope } from "@/lib/skills/feedback-rollup"
import { GLOBAL_MIN_ORG_SUPPORT_N } from "@/lib/skills/feedback-rollup"

/** A persisted rollup row as read back from skill_feedback_rollup (loose-typed). */
export type RollupReadRow = {
  skillId: string
  scope: RollupScope
  scopeId: string | null
  playTypeKey: string
  bayesScore: number
  multiplier: number
  supportN: number
  orgSupportN: number
}

/** Tunables for the weekly distill — kept here (distill policy), separate from the scoring multiplier
 *  tunables (scoring-config.ts) and the action band (feedback-signals.ts). */
export const DISTILL_MIN_SUPPORT_N = 20 // well above PLAY_TYPE_MIN_SUPPORT_N — a learning needs real mass
export const DISTILL_STRONG_LIKED = 0.66 // bayes_score above this → a "lean into" pattern
export const DISTILL_STRONG_DISLIKED = 0.34 // bayes_score below this → a "bias away" pattern

/** A distilled feedback_pattern candidate — the skill_knowledge row shape (status defaults conservative). */
export type FeedbackPatternCandidate = {
  skillId: string
  scope: RollupScope
  scopeId: string | null
  playTypeKey: string
  title: string
  snippet: string
  confidence: number
  supportN: number
  status: "candidate" | "shadow"
  direction: "liked" | "disliked"
}

/** Parse a play_type_key (skillId|kind|leadDomain|sevBand) for human-readable snippet composition. */
function parseKey(k: string): { kind: string; leadDomain: string; sevBand: string } {
  const [, kind = "", leadDomain = "", sevBand = ""] = k.split("|")
  return { kind, leadDomain, sevBand }
}

/**
 * Decide whether a SET of rollup rows for one (skill, scope, scope_id, play_type_key family) distills
 * into a feedback_pattern, applying the guardrails. `rowsForKey` are the rows that share a play_type
 * EXCEPT severity band (so we can check cross-band consistency). PURE + deterministic.
 *
 * Returns a candidate or null. A GLOBAL candidate is downgraded to org-scope if it can't clear the
 * confounder guard; a negative pattern is never written above `shadow` from the deterministic policy
 * (human review promotes it to active — the conservative direction).
 */
export function distillPattern(
  skillId: string,
  scope: RollupScope,
  scopeId: string | null,
  playTypeFamily: string,
  rowsForKey: RollupReadRow[],
): FeedbackPatternCandidate | null {
  if (rowsForKey.length === 0) return null

  // (a) support: aggregate support across the bands; require real mass.
  const totalSupport = rowsForKey.reduce((s, r) => s + r.supportN, 0)
  if (totalSupport < DISTILL_MIN_SUPPORT_N) return null

  // direction: support-weighted mean liked-rate.
  const weightedScore = rowsForKey.reduce((s, r) => s + r.bayesScore * r.supportN, 0) / totalSupport
  const liked = weightedScore >= DISTILL_STRONG_LIKED
  const disliked = weightedScore <= DISTILL_STRONG_DISLIKED
  if (!liked && !disliked) return null // not a strong-enough pattern in either direction

  // (b) severity-aware: the pattern must hold across >= 2 severity bands (each with some support), so a
  // signal that only appears at one adventurousness level is "that band is too wild", not "bad type".
  const bandsWithSupport = new Set(
    rowsForKey.filter((r) => r.supportN > 0).map((r) => parseKey(r.playTypeKey).sevBand),
  )
  if (bandsWithSupport.size < 2) return null

  // (c) confounder: a global pattern needs multi-org support; else fall back to org scope.
  const effScope = scope
  const effScopeId = scopeId
  if (scope === "global") {
    const maxOrgSupport = Math.max(...rowsForKey.map((r) => r.orgSupportN))
    if (maxOrgSupport < GLOBAL_MIN_ORG_SUPPORT_N) {
      // Can't be a global learning — but we have no single org id at global scope, so we DROP it
      // rather than fabricate an org id (the org-scope rows distill on their own pass).
      return null
    }
  }

  const { kind, leadDomain, sevBand } = parseKey(playTypeFamily)
  const direction: "liked" | "disliked" = liked ? "liked" : "disliked"
  const verb = liked ? "consistently land" : "are consistently rejected"
  const guidance = liked
    ? `Lean into ${kind} plays grounded in ${leadDomain}; this pattern is earning thumbs across operators.`
    : `Bias away from ${kind} plays grounded in ${leadDomain}; operators repeatedly reject them — find a different angle.`
  const snippet =
    `Operator feedback shows ${kind || "these"} plays in the ${leadDomain || "this"} domain ${verb} ` +
    `(${(weightedScore * 100).toFixed(0)}% liked across ${totalSupport} signals, ${bandsWithSupport.size} severity bands). ${guidance}`.slice(0, 600)

  // confidence: scale with support + distance from neutral, capped. A negative pattern stays `shadow`
  // (compute + observe) until human review; a positive pattern may go `candidate` for auto-promotion.
  const confidence = Math.min(95, Math.round(50 + Math.abs(weightedScore - 0.5) * 80 + Math.min(20, totalSupport / 5)))

  return {
    skillId,
    scope: effScope,
    scopeId: effScopeId,
    playTypeKey: playTypeFamily,
    title: `feedback: ${kind || "play"}/${leadDomain || "signal"} ${direction}`.slice(0, 80),
    snippet,
    confidence,
    supportN: totalSupport,
    status: disliked ? "shadow" : "candidate",
    direction,
  }
}

/** Group rollup rows into play_type FAMILIES (same skill/scope/scope_id/kind/leadDomain, ANY sevBand)
 *  and distill each. The family key drops the severity band so cross-band consistency can be checked. */
export function distillPatterns(rows: RollupReadRow[]): FeedbackPatternCandidate[] {
  const familyKey = (r: RollupReadRow): string => {
    const { kind, leadDomain } = parseKey(r.playTypeKey)
    return [r.skillId, r.scope, r.scopeId ?? "", kind, leadDomain].join("")
  }
  const families = new Map<string, RollupReadRow[]>()
  for (const r of rows) {
    const k = familyKey(r)
    const arr = families.get(k) ?? []
    arr.push(r)
    families.set(k, arr)
  }
  const out: FeedbackPatternCandidate[] = []
  for (const group of families.values()) {
    const first = group[0]
    const { kind, leadDomain } = parseKey(first.playTypeKey)
    // The family's representative play_type_key (band-agnostic) for the candidate row.
    const familyTypeKey = [first.skillId, kind, leadDomain, "*"].join("|")
    const candidate = distillPattern(first.skillId, first.scope, first.scopeId, familyTypeKey, group)
    if (candidate) out.push(candidate)
  }
  // Deterministic order for idempotent writes.
  out.sort((a, b) => a.skillId.localeCompare(b.skillId) || a.title.localeCompare(b.title))
  return out
}
