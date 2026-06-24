// ---------------------------------------------------------------------------
// Learning Spine L3 (P17a) — VERSIONING + SAFETY: AUTO-PROMOTION + RETIRE (§2.3.3 + §2.4).
//
// At the END of the weekly distill, candidate/shadow skill_knowledge rows are evaluated for
// auto-promotion to `active`, and stale rows are retired. This is the PURE policy that decides, per
// row, the next status. It runs over rows ALREADY written by the three pipelines; it never fabricates
// a row and never relaxes grounding.
//
// THE PROMOTION MATRIX (§2.3.3):
//   - external_trend   → auto-promote candidate/shadow → active when CORROBORATED (support_n >= the
//                        corroboration floor) AND confidence >= the bar. A lone/low row stays put.
//   - feedback_pattern → auto-promote candidate → active when support_n >= the support bar AND
//                        confidence >= the bar. A `shadow` feedback_pattern (the conservative negative
//                        direction) is NEVER auto-promoted — it waits for human review.
//   - question_demand  → NEVER auto-promoted (human-only — TicketAdmin). A question reveals DEMAND,
//                        not a vetted answer.
//   - editorial        → NEVER auto-promoted (human-only — it edits the playbook framing).
//
// RETIRE: any ACTIVE row whose active_window.effective_to has passed is retired (it drops from the
// next prompt build — the loader already window-filters, but flipping status makes the retirement
// durable + visible in the admin queue). Instant + deploy-free: it's a data status flip.
//
// PURE + deterministic (no DB, no LLM) → unit-tests without a transport. The runner (promotion-run.ts)
// reads candidate/shadow/active rows and applies the decided status flips.
// ---------------------------------------------------------------------------

export type LearningKind = "external_trend" | "feedback_pattern" | "question_demand" | "editorial"
export type KnowledgeStatus = "candidate" | "shadow" | "active" | "retired"

/** A skill_knowledge row, slimmed to what the promotion decision needs (loose-typed read). */
export type PromotableRow = {
  id: string
  skillId: string
  learningKind: LearningKind
  status: KnowledgeStatus
  confidence: number
  supportN: number
  /** active_window.effective_to as ms, or null/Infinity for open-ended. */
  effectiveToMs: number | null
}

// ── Tunables (one place) ────────────────────────────────────────────────────────────────────────
/** external_trend: # corroborating sources (support_n) required to auto-promote. Matches the
 *  ingest corroboration rule (≥2 distinct sources → corroborated). */
export const TREND_CORROBORATION_FLOOR = 2
/** external_trend: confidence bar to auto-promote (mirrors ingest TIER1_AUTOPROMOTE_CONFIDENCE). */
export const TREND_PROMOTE_CONFIDENCE = 70
/** feedback_pattern: support_n bar to auto-promote a POSITIVE (candidate) pattern. */
export const FEEDBACK_PROMOTE_SUPPORT_N = 20
/** feedback_pattern: confidence bar to auto-promote. */
export const FEEDBACK_PROMOTE_CONFIDENCE = 60

/** The learning_kinds that may EVER auto-promote. question_demand + editorial are human-only. */
const AUTO_PROMOTABLE_KINDS = new Set<LearningKind>(["external_trend", "feedback_pattern"])

/** A decided status change for one row (the runner applies these as a status flip). */
export type PromotionDecision = {
  id: string
  skillId: string
  learningKind: LearningKind
  from: KnowledgeStatus
  to: "active" | "retired"
  reason:
    | "trend_corroborated"
    | "feedback_supported"
    | "window_expired"
}

/**
 * True iff this row is eligible to AUTO-promote to active. PURE. The single chokepoint that proves
 * question_demand (and editorial) NEVER auto-promote regardless of confidence/support — the human
 * gate is the only path to active for those kinds (spec §2.2 P3 (c) / §2.4).
 */
export function canAutoPromote(row: Pick<PromotableRow, "learningKind" | "status" | "confidence" | "supportN">): boolean {
  // Human-only kinds: hard stop. This is the assertion the tests pin.
  if (!AUTO_PROMOTABLE_KINDS.has(row.learningKind)) return false
  // Already active/retired → nothing to promote.
  if (row.status === "active" || row.status === "retired") return false

  if (row.learningKind === "external_trend") {
    // A trend auto-promotes from candidate OR shadow once corroborated + confident.
    return row.supportN >= TREND_CORROBORATION_FLOOR && row.confidence >= TREND_PROMOTE_CONFIDENCE
  }
  if (row.learningKind === "feedback_pattern") {
    // Only the POSITIVE direction reaches `candidate`; the negative direction is written `shadow` and
    // must wait for human review (conservative). So auto-promote ONLY from `candidate`.
    if (row.status !== "candidate") return false
    return row.supportN >= FEEDBACK_PROMOTE_SUPPORT_N && row.confidence >= FEEDBACK_PROMOTE_CONFIDENCE
  }
  return false
}

/** Has this row's active window expired as of `nowMs`? Open-ended (null/Infinity) never expires. */
export function isExpired(row: Pick<PromotableRow, "effectiveToMs">, nowMs: number): boolean {
  return row.effectiveToMs != null && Number.isFinite(row.effectiveToMs) && (row.effectiveToMs as number) <= nowMs
}

/**
 * Decide the status flips for a set of rows at the end of the weekly distill. PURE + deterministic.
 *   - ACTIVE rows past their effective_to → retire (durable retirement; drops from the next build).
 *   - candidate/shadow auto-promotable rows (trend corroborated / feedback supported) → active —
 *     UNLESS the row is itself already expired (don't promote a dead trend).
 *   - everything else (incl. ALL question_demand + editorial) → no change (human gate / not yet met).
 */
export function decidePromotions(rows: PromotableRow[], nowMs: number): PromotionDecision[] {
  const out: PromotionDecision[] = []
  for (const row of rows) {
    // Retire an active row whose window has passed.
    if (row.status === "active" && isExpired(row, nowMs)) {
      out.push({ id: row.id, skillId: row.skillId, learningKind: row.learningKind, from: row.status, to: "retired", reason: "window_expired" })
      continue
    }
    // Auto-promote — but never promote a row that's already expired (it would retire on the next pass).
    if (canAutoPromote(row) && !isExpired(row, nowMs)) {
      out.push({
        id: row.id,
        skillId: row.skillId,
        learningKind: row.learningKind,
        from: row.status,
        to: "active",
        reason: row.learningKind === "external_trend" ? "trend_corroborated" : "feedback_supported",
      })
    }
  }
  // Deterministic order (retire before promote within a skill, then by id) for idempotent writes/logs.
  out.sort(
    (a, b) =>
      a.skillId.localeCompare(b.skillId) ||
      (a.to === b.to ? 0 : a.to === "retired" ? -1 : 1) ||
      a.id.localeCompare(b.id),
  )
  return out
}
