// ALT-292: how the /insights sections decide what a "show more" click actually loads.
//
// The old behavior was one boolean per section: 6 cards, then a single button that
// swapped the limit for the full list. On a mature section that read "Show 64 more"
// and dumped all 64 at once. The planner replaces it: a reveal adds ONE batch, and the
// button's count is always exactly what the click will add.
//
// Deliberately framework-free (no React, no client directive) so it stays unit-testable.
// The recency-window helpers that used to live beside it (recentCutoffDateKey,
// splitByRecency, defaultRevealCount) retired with the per-category feed in the
// 2026-08-13 /insights consolidation; `recentCount` stays on the planner's contract so
// a future recency-banded section can reuse it unchanged.

export type RevealPlan = {
  /** exactly how many cards the next click adds */
  nextCount: number
  /** everything still unloaded, including anything past `nextCount` */
  remaining: number
  /** the next click crosses out of the recent window into older material */
  olderNext: boolean
}

/**
 * What the reveal footer should say and do next. While recent material is left, the
 * batch stops at the end of the window: "Show 4 more" can never quietly drag two
 * month-old cards in behind it. Sections with no recency notion pass `recentCount: 0`.
 */
export function revealPlan({
  shown,
  recentCount,
  total,
  batch,
}: {
  shown: number
  recentCount: number
  total: number
  batch: number
}): RevealPlan {
  const boundary = shown < recentCount ? recentCount : total
  return {
    nextCount: Math.max(0, Math.min(batch, boundary - shown)),
    remaining: Math.max(0, total - shown),
    olderNext: recentCount > 0 && shown >= recentCount,
  }
}
