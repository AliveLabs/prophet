// ---------------------------------------------------------------------------
// Review watchdog (beta rescue phase 4.2): operator-facing wording.
//
// Lives in lib/ rather than beside the page because it has TWO consumers: the
// /reviews watch panel and the weekly digest email. EVERY operator-facing string
// is in WATCH_COPY, so wording is a one-file change (the REVIEWS_COPY convention).
//
// Voice rules (CI-gated via lintVoice): plain language, no kitchen lingo, no em
// dashes, and never a data source named. The numbers shown here are deliberately
// the ones an operator can check against their own listing (star averages and
// review counts). The test statistic behind the finding is NOT shown: it is an
// audit value on the row, not something to make an owner interpret.
//
// FAIL-SOFT: a row whose stored detail does not parse is DROPPED, never rendered
// with a guessed number. A watchdog that invents a figure is worse than a quiet one.
// ---------------------------------------------------------------------------

import type { WatchEventRow } from "@/lib/reviews/watch-events"

export const WATCH_COPY = {
  panel: {
    title: "What moved",
    sub: "Changes worth knowing about, based on your own review history.",
  },
  ratingDown: {
    title: "Your recent reviews are running lower",
    tone: "attention" as const,
  },
  ratingUp: {
    title: "Your recent reviews are running higher",
    tone: "good" as const,
  },
  velocityDown: {
    title: "Reviews have gone quiet",
    tone: "attention" as const,
  },
  velocityUp: {
    title: "Reviews are coming in fast",
    tone: "good" as const,
  },
  /** Red-flag categories are the scoring pass's whitelist (lib/reviews/scoring.ts). */
  cluster: {
    illness: "Several reviews mention people getting sick",
    food_safety: "Several reviews raise a food safety concern",
    discrimination: "Several reviews allege discrimination",
    safety: "Several reviews raise a safety concern",
    legal: "Several reviews raise a legal concern",
    fallback: "Several reviews raise the same serious concern",
  } as Record<string, string>,
  clusterRare: "This almost never comes up in your reviews.",
  clusterAboveUsual: "That is well above your usual level.",
  footer: "The reviews behind this are below.",
} as const

export type WatchTone = "attention" | "good"

/** One rendered notice. Serializable, so the page hands it straight to markup and
 *  the email template reads the same shape. */
export type WatchNoticeView = {
  key: string
  tone: WatchTone
  title: string
  line: string
  /** "Aug 14" style, or null when the stored date does not parse. */
  when: string | null
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const stars = (n: number): string => n.toFixed(1)
/** Expected counts are estimates; a whole number reads honestly, and it never
 *  rounds to zero (an expectation below one still means "at least one"). */
const roughly = (n: number): number => Math.max(1, Math.round(n))
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

function whenLabel(firedOn: string): string | null {
  const ms = Date.parse(`${firedOn}T00:00:00Z`)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

/** Build one notice from a stored row. Null when the row's detail is unusable. */
export function buildWatchNotice(row: WatchEventRow): WatchNoticeView | null {
  const detail = (row.detail ?? {}) as Record<string, unknown>
  const when = whenLabel(row.fired_on)

  if (row.kind === "rating_move") {
    const recentCount = num(detail.recentCount)
    const recentMean = num(detail.recentMean)
    const baselineCount = num(detail.baselineCount)
    const baselineMean = num(detail.baselineMean)
    if (recentCount == null || recentMean == null || baselineCount == null || baselineMean == null) return null
    const copy = row.direction === "down" ? WATCH_COPY.ratingDown : WATCH_COPY.ratingUp
    return {
      key: row.anomaly_key,
      tone: copy.tone,
      title: copy.title,
      line:
        `Your last ${recentCount} ${plural(recentCount, "review", "reviews")} average ${stars(recentMean)} stars. ` +
        `Your usual is ${stars(baselineMean)} across the ${baselineCount} before them.`,
      when,
    }
  }

  if (row.kind === "review_velocity") {
    const recentCount = num(detail.recentCount)
    const expectedCount = num(detail.expectedCount)
    const windowDays = num(detail.windowDays)
    if (recentCount == null || expectedCount == null || windowDays == null) return null
    const copy = row.direction === "down" ? WATCH_COPY.velocityDown : WATCH_COPY.velocityUp
    return {
      key: row.anomaly_key,
      tone: copy.tone,
      title: copy.title,
      line:
        `${recentCount} new ${plural(recentCount, "review", "reviews")} in the last ${windowDays} days. ` +
        `At your usual pace you would have about ${roughly(expectedCount)}.`,
      when,
    }
  }

  if (row.kind === "red_flag_cluster") {
    const recentCount = num(detail.recentCount)
    const windowDays = num(detail.windowDays)
    const baselineExpected = num(detail.baselineExpected)
    const category = typeof detail.category === "string" ? detail.category : null
    if (recentCount == null || windowDays == null || baselineExpected == null || category == null) return null
    const context = baselineExpected < 1 ? WATCH_COPY.clusterRare : WATCH_COPY.clusterAboveUsual
    return {
      key: row.anomaly_key,
      tone: "attention",
      title: WATCH_COPY.cluster[category] ?? WATCH_COPY.cluster.fallback,
      line: `${recentCount} reviews in the last ${windowDays} days raise this. ${context}`,
      when,
    }
  }

  return null
}

/** Attention first, then most recently flagged. Good news never leads a watch panel. */
export function buildWatchNotices(rows: WatchEventRow[]): WatchNoticeView[] {
  const notices: Array<{ view: WatchNoticeView; firedOn: string; i: number }> = []
  rows.forEach((row, i) => {
    const view = buildWatchNotice(row)
    if (view) notices.push({ view, firedOn: row.fired_on, i })
  })
  return notices
    .sort(
      (a, b) =>
        (a.view.tone === "attention" ? 0 : 1) - (b.view.tone === "attention" ? 0 : 1) ||
        b.firedOn.localeCompare(a.firedOn) ||
        a.i - b.i,
    )
    .map((n) => n.view)
}
