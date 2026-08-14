// ---------------------------------------------------------------------------
// Thin-read rejection at capture.
//
// A page that yields dramatically fewer items than that same URL has yielded before is a
// failed scrape, not a shrunken menu. Real menus change roughly annually; a page going from
// 60 items to 9 between two weekly runs is the extractor failing, and storing it writes a
// falsehood the rest of the product then reasons over.
//
// Measured on one restaurant's stored weekly captures (2026-06-23 to 2026-08-09), per URL:
//   dinner-menu   60, 60, 9, 60, 9, 9, 63, 9, 1, 9, 9, 9 ...
//   drink-menu    58, 58, 18, 58, 19, 18, 18 ...
//   brunch-menu   22, 22, 3, 3, 3 ...
// Every thin value is one section of a page whose full text was present. This rule is what
// keeps those out of storage.
//
// PURE and total: no IO, no clock, no randomness. The pipeline reads the verdict and either
// retries or records a failure; nothing here decides that.
// ---------------------------------------------------------------------------

import type { MenuPageRead, MenuSnapshot } from "./types"

/** Below this share of the URL's own best recent read, a capture is not believable. */
export const THIN_READ_RATIO = 0.5
/** Reads needed before "this URL's own history" means anything. */
export const MIN_HISTORY_FOR_THIN_CHECK = 2
/** Never judge a page thin against a tiny baseline; the noise would swamp the signal. */
export const MIN_BASELINE_ITEMS = 6

/**
 * The item count this URL should be expected to produce, or null when we cannot say.
 *
 * The MAXIMUM, not the median or the second-highest. menuCoverage() in menu-parse.ts uses
 * second-highest because it is answering a different question over a window that may be
 * mostly healthy. Here the window is frequently mostly BROKEN — the restaurant above has
 * eleven 9-item reads and one 63-item read for the same page — and any central statistic
 * would ratify the broken reads as normal. The cost of using the max is that one over-read
 * could gate a real one for a while; that is the right way round, because a rejected read
 * is a logged gap the union already covers, while an accepted thin read is a wrong number
 * presented as truth.
 */
export function menuPageBaseline(counts: number[]): number | null {
  const usable = counts.filter((n) => Number.isFinite(n) && n > 0)
  if (usable.length < MIN_HISTORY_FOR_THIN_CHECK) return null
  const best = Math.max(...usable)
  return best >= MIN_BASELINE_ITEMS ? best : null
}

export type ThinReadVerdict = {
  thin: boolean
  /** Expected count this was judged against; null when there was no verdict to give. */
  baseline: number | null
  /** items / baseline, rounded to 2dp. Null when there was no baseline. */
  ratio: number | null
}

/** Judge one page's item count against that page's own history. Absence of history is never thin. */
export function assessThinRead(items: number, historyCounts: number[]): ThinReadVerdict {
  const baseline = menuPageBaseline(historyCounts)
  if (baseline === null) return { thin: false, baseline: null, ratio: null }
  const ratio = Math.round((items / baseline) * 100) / 100
  return { thin: items < baseline * THIN_READ_RATIO, baseline, ratio }
}

/**
 * Per-URL item-count history from recent snapshots, newest-first.
 *
 * Only reads a snapshot recorded as NOT thin: a rejected read must not become the baseline
 * that makes the next rejected read look normal. Snapshots captured before parseMeta.pages
 * existed contribute nothing, so the check simply has no opinion until history accrues —
 * which is correct, and is why markdown-first extraction (not this rule) is the primary fix.
 */
export function collectPageHistory(
  snapshots: Array<MenuSnapshot | null | undefined>
): Map<string, number[]> {
  const history = new Map<string, number[]>()
  for (const snapshot of snapshots) {
    for (const page of snapshot?.parseMeta?.pages ?? []) {
      if (page.thin) continue
      if (!Number.isFinite(page.items) || page.items <= 0) continue
      const list = history.get(page.url)
      if (list) list.push(page.items)
      else history.set(page.url, [page.items])
    }
  }
  return history
}

/** Sum of the accepted pages, for logging and for the telemetry `stages` blob. */
export function acceptedItemCount(pages: MenuPageRead[]): number {
  return pages.filter((p) => !p.thin).reduce((sum, p) => sum + p.items, 0)
}
