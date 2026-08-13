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
import {
  insightChipLabel,
  insightConfLevel,
  insightImpactLevel,
  insightWhyPoints,
  insightRecs,
  type FeedInsight,
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
