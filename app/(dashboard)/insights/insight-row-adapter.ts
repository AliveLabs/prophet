// A stored `insights` row (FeedInsight) → UnifiedInsight.
//
// The companion to app/(dashboard)/home/unified-insight-adapter.ts: that module translates
// the RICHEST record in the product (a play with a recipe); this one translates the LEANEST
// (a raw detector row). NOTHING here invents a field the row doesn't carry.
//
// Pure functions only (no JSX, no React) so it is server-safe and unit-testable — vitest
// collects `tests/unit/**/*.test.ts` and no `.tsx`.
//
// THE HONEST-GATING RULES, each of which is a decision not to guess:
//   · Tier is DERIVED, never stored. An `insights` row's `recommendations[]` entry has
//     exactly two keys (title, rationale) — no steps, no channels, no windows — so a row
//     can NEVER claim the "has a plan" tier. Recommendations present → `suggestion`;
//     absent → `observation`. `plan` stays undefined unconditionally.
//   · No `when` chip, ever: a detector row carries no window date, and a timing claim
//     without a date behind it is a guess. Severity already rides the impact axis.
//   · The validation line is DENOMINATED or absent. A row has no evidence rate, so it is
//     absent — the metric pills in the card's support region carry the honest numbers.
//   · No numerals reach a score. `relevanceScore` ranks; it never renders.

import type { UnifiedInsight, InsightTag } from "@/components/insights/unified-insight-card"
import type { FeedInsight } from "./insights-feed-kit"
import {
  insightChipLabel,
  insightConfLevel,
  insightImpactLevel,
  insightWhyPoints,
  insightRecs,
  insightCategory,
} from "./insights-map"

/**
 * Keep/Dismiss state for the unified card, derived from the row's lifecycle status.
 * The legacy positive statuses (read / todo / actioned — written by the retired Track
 * menu) all read as "kept" so old rows keep their state; the cleared statuses read as
 * dismissed; `new` is untouched.
 */
export function insightKeptState(status: string): boolean | null {
  if (status === "read" || status === "todo" || status === "actioned") return true
  if (status === "dismissed" || status === "inaccurate" || status === "snoozed") return false
  return null
}

export function insightRowToUnifiedInsight(row: FeedInsight): UnifiedInsight {
  const tags: InsightTag[] = [
    { axis: "what", label: insightChipLabel(row) },
    // ALT-230: the freshness marker for a just-generated insight is product state, so it
    // rides the state axis (green), never the timing axis.
    ...(row.justGenerated ? [{ axis: "state" as const, label: "Just generated" }] : []),
  ]

  // One suggested next step, verbatim from the stored recommendation's title. The region
  // label on the card is singular, so only the first titled recommendation speaks — a row
  // with several still shows one honest line rather than a fake multi-step plan.
  const suggestion = insightRecs(row, 1)[0]?.title ?? null

  return {
    id: row.id,
    title: row.title,
    why: row.summary,
    tags,
    confidence: insightConfLevel(row.confidence),
    impact: insightImpactLevel(row.severity),
    // Denominated or absent: a detector row cites no rate, so it is absent.
    validation: null,
    whyPoints: insightWhyPoints(row),
    // NEVER a plan: the row's data has no steps to promise.
    plan: undefined,
    suggestion,
    // The `insights` surface has no per-row detail page, so no link is promised.
    detailHref: undefined,
  }
}

// ---------------------------------------------------------------------------
// The deterministic priority pick — replaces the model-generated Priority Briefing.
//
// Same shape /home uses: a fixed-size, diversity-guarded pick over scores that already
// exist, composed with zero model calls. One insight per source category first (each
// category's best by relevanceScore), then fill by score, final order by score.
// ---------------------------------------------------------------------------

export const PRIORITY_COUNT = 5

const CLEARED_STATUSES = new Set(["dismissed", "snoozed", "inaccurate"])

export function pickPriorityInsights(rows: FeedInsight[], max: number = PRIORITY_COUNT): FeedInsight[] {
  // ALT-230 hero-equivalent guard: user-generated viz insights never reach a priority
  // surface (same rule as the home hero/dossier). Suppressed types (down-weighted by the
  // operator's own feedback) and cleared rows don't belong at the top either.
  const eligible = rows.filter(
    (r) => !r.insightType.startsWith("user_viz") && !r.suppressed && !CLEARED_STATUSES.has(r.status),
  )
  if (eligible.length === 0) return []

  const byScore = [...eligible].sort((a, b) => b.relevanceScore - a.relevanceScore)

  // Round one: each source category's single best, so the pick can never be five rows of
  // the same stream.
  const picked: FeedInsight[] = []
  const pickedIds = new Set<string>()
  const seenCategories = new Set<string>()
  for (const row of byScore) {
    if (picked.length >= max) break
    const cat = insightCategory(row)
    if (seenCategories.has(cat)) continue
    seenCategories.add(cat)
    picked.push(row)
    pickedIds.add(row.id)
  }

  // Round two: fill the remainder by plain score.
  for (const row of byScore) {
    if (picked.length >= max) break
    if (pickedIds.has(row.id)) continue
    picked.push(row)
    pickedIds.add(row.id)
  }

  return picked.sort((a, b) => b.relevanceScore - a.relevanceScore)
}
