// ---------------------------------------------------------------------------
// ALT-246 — the PURE mark-resolved/reopen transition policy + flag-ref parser for the
// Source Quality review queue. Kept separate from the server action (and from
// lib/skills/source-quality.ts) so the transition logic is unit-testable without
// React / Supabase / auth, mirroring lib/skills/knowledge-admin.ts.
//
// SCOPE NOTE: this module is intentionally NOT imported by lib/skills/source-quality.ts,
// app/admin/source-quality/page.tsx, or the presentation component — those three stay
// read-only per the ALT-172 isolation guard (tests/unit/skills/source-quality.test.ts).
// This module (and the server action that calls it) only ever writes the NEW
// reviewed_status/reviewed_by/reviewed_at columns — never `action`/`reason`/`status`
// (the columns lib/skills/feedback-rollup.ts reads) — so triage stays a data-quality-only
// loop, same hard constraint as ALT-172.
// ---------------------------------------------------------------------------

export type ReviewStatus = "open" | "resolved"
export type ReviewAction = "resolve" | "reopen"

/** The target reviewed_status for each triage action. */
export function targetReviewStatusFor(action: ReviewAction): ReviewStatus {
  switch (action) {
    case "resolve":
      return "resolved"
    case "reopen":
      return "open"
  }
}

/** Is this transition allowed? A no-op (target == current) is rejected so the UI never
 *  logs an empty change / stamps a fresh reviewed_at over an unrelated resolution. */
export function isAllowedReviewTransition(current: ReviewStatus, action: ReviewAction): boolean {
  return current !== targetReviewStatusFor(action)
}

/** Which flag a triage action targets: a brief play (identified by its natural key —
 *  location_id + date_key + play_key) or an insight (identified by its row id). */
export type FlagRef =
  | { kind: "brief_play"; locationId: string; dateKey: string; playKey: string }
  | { kind: "insight"; id: string }

/** Parse a SourceQualityFlag.id (see lib/skills/source-quality.ts) back into the identity
 *  a mutation needs. Mirrors the id shapes emitted by resolvePlayFlag/insightFlag exactly:
 *    `brief:${location_id}:${date_key}:${play_key}`
 *    `insight:${id}`
 *  play_key itself may contain `:` (it's `${skillId}::${title}`), so brief refs split on
 *  the first THREE colons only, leaving the remainder as the play_key. Returns null for
 *  any ref that doesn't match either shape — callers should treat that as "reject the
 *  action", never guess. */
export function parseFlagRef(ref: string): FlagRef | null {
  if (typeof ref !== "string" || !ref.trim()) return null

  if (ref.startsWith("insight:")) {
    const id = ref.slice("insight:".length)
    return id ? { kind: "insight", id } : null
  }

  if (ref.startsWith("brief:")) {
    const rest = ref.slice("brief:".length)
    const firstColon = rest.indexOf(":")
    if (firstColon < 0) return null
    const locationId = rest.slice(0, firstColon)
    const afterLoc = rest.slice(firstColon + 1)
    const secondColon = afterLoc.indexOf(":")
    if (secondColon < 0) return null
    const dateKey = afterLoc.slice(0, secondColon)
    const playKey = afterLoc.slice(secondColon + 1)
    if (!locationId || !dateKey || !playKey) return null
    return { kind: "brief_play", locationId, dateKey, playKey }
  }

  return null
}
