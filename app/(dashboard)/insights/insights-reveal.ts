// ALT-292: how the /insights feed decides what to show first and what a "show more"
// click actually loads.
//
// The old behavior was one boolean per section: 6 cards, then a single button that
// swapped the limit for the full list. On a mature category that read "Show 64 more"
// and dumped all 64 at once. Two rules replace it, and both live here as pure
// functions so they can be tested without rendering the feed:
//
//   1. A category DEFAULTS to a recent window instead of every insight ever generated.
//      Older insights stay reachable, just behind a labelled step.
//   2. A reveal adds ONE batch, and never straddles the recent/older boundary, so the
//      button's count is always exactly what the click will add.
//
// Deliberately framework-free (no React, no client directive): the server page imports
// the window constant and the cutoff helper, the client feed imports the planners.

/** How far back a category's default view reaches. */
export const INSIGHT_RECENT_WINDOW_DAYS = 7

/**
 * The inclusive `YYYY-MM-DD` start of the recent window, stepped off `todayDateKey`
 * in whole calendar days so it lines up with how `insights.date_key` is written.
 * A 7-day window ending today starts 6 days back.
 */
export function recentCutoffDateKey(
  todayDateKey: string,
  windowDays: number = INSIGHT_RECENT_WINDOW_DAYS,
): string {
  const d = new Date(`${todayDateKey}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return todayDateKey
  d.setUTCDate(d.getUTCDate() - (Math.max(1, windowDays) - 1))
  return d.toISOString().slice(0, 10)
}

/**
 * Partition a category's insights into the recent window followed by everything
 * older, preserving the relevance order the server sent within each run. An absent
 * or unparseable `dateKey` sorts as older rather than being dropped.
 */
export function splitByRecency<T extends { dateKey?: string | null }>(
  list: readonly T[],
  cutoff: string,
): { ordered: T[]; recentCount: number } {
  const recent: T[] = []
  const older: T[] = []
  for (const item of list) {
    if ((item.dateKey ?? "") >= cutoff) recent.push(item)
    else older.push(item)
  }
  return { ordered: recent.concat(older), recentCount: recent.length }
}

/**
 * How many cards a section shows before the operator has touched it. Defaults to the
 * recent window capped at one batch; a section with nothing recent still opens with a
 * batch of its older items rather than rendering as an empty shell.
 *
 * Sections with no recency notion (Pinned, the board columns) pass `recentCount: 0`.
 */
export function defaultRevealCount(recentCount: number, total: number, batch: number): number {
  return Math.max(0, Math.min(batch, recentCount || total))
}

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
 * month-old cards in behind it.
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
