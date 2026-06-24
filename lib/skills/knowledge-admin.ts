// ---------------------------------------------------------------------------
// Learning Spine L3 (P17a) — the PURE human-promotion transition policy for the TicketAdmin
// knowledge-review UI. Kept separate from the server action so the allowed-transition logic is
// unit-testable without React / Supabase / auth.
//
// This is the HUMAN gate (§2.3.3). Unlike auto-promotion (promotion.ts, which never touches
// question_demand), a human MAY promote ANY kind — including a question_demand or editorial row — to
// active, or retire any row. The gate is the human's judgment + the super_admin capability; the policy
// here just enforces which status TRANSITIONS are valid so the UI can't request an incoherent one.
// ---------------------------------------------------------------------------

export type KnowledgeStatus = "candidate" | "shadow" | "active" | "retired"
export type KnowledgeAction = "promote" | "retire" | "shadow"

/** The target status for each admin action. promote → active; retire → retired; shadow → shadow
 *  (move an active/candidate row INTO shadow to observe-only without serving). */
export function targetStatusFor(action: KnowledgeAction): KnowledgeStatus {
  switch (action) {
    case "promote":
      return "active"
    case "retire":
      return "retired"
    case "shadow":
      return "shadow"
  }
}

/**
 * Is this human transition allowed? PURE. The human gate is permissive (a human may promote any KIND),
 * but transitions must be COHERENT:
 *   - promote (→active): from candidate or shadow (not from active — already there; not from retired —
 *     re-promoting a retired row should be a deliberate re-candidate first, kept out of one click).
 *   - retire (→retired): from candidate, shadow, OR active (instant rollback of a live learning).
 *   - shadow (→shadow): from candidate or active (drop a live row back to observe-only).
 * A no-op (target == current) is rejected so the UI never logs an empty change.
 */
export function isAllowedTransition(current: KnowledgeStatus, action: KnowledgeAction): boolean {
  const target = targetStatusFor(action)
  if (current === target) return false
  switch (action) {
    case "promote":
      return current === "candidate" || current === "shadow"
    case "retire":
      return current === "candidate" || current === "shadow" || current === "active"
    case "shadow":
      return current === "candidate" || current === "active"
  }
}
