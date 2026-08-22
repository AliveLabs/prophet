// ---------------------------------------------------------------------------
// ALT-571 Tier 1 — an unexpected ZERO has to reach a human.
//
// THE FAILURE CLASS THIS EXISTS FOR, four recurrences deep:
//
//   2026-06     the fetch never asked for the stadium (keyword monoculture)
//   2026-07     producers silently served 16k-truncated fallbacks for two weeks
//   2026-08 (a) the fetch asked correctly and the UI discarded the answer (PR #187)
//   2026-08 (b) the vendor went fully dark and returned a polite empty for FIVE DAYS,
//               fleet-wide, while every run logged outcome "fresh" and failed: 0
//
// Every time, an empty or degraded result was indistinguishable from a legitimately quiet one, so
// nothing fired. The 08-05 blackout was found because a human happened to ask why one concert was
// missing.
//
// WHY THE EXISTING DETECTOR COULD NOT CATCH IT. `detectDataForSeoHealth` in vendor-health.ts is
// good at what it does and structurally blind here: it classifies the fleet from
// `pipeline_runs.outcome`, which only ever answers "did this call error?" A benign empty is not an
// error. Worse, the 40102 "No Search Results" code is deliberately mapped to `[]` rather than a
// throw (correctly, for a single query), so the exact shape of the five-day outage was invisible by
// design.
//
// THE RULE THIS FOLLOWS. A health metric must not derive from the same predicate as the behaviour
// it measures. So this counts POPULATED SNAPSHOTS at the source: `location_snapshots.raw_data` is
// the artefact the product actually reads, and counting it cannot be fooled by a run that reported
// success. It also subsumes ALT-571's Tier 2 (aggregate the 40102s) without touching the vendor
// client: a fleet of 40102 responses produces a fleet of empty snapshots, which is what this sees.
//
// WHAT MUST STAY SILENT, because an alerter that cries wolf gets filtered into a folder nobody
// reads, and then we are back to five silent days:
//   - one rural location with no events this week            -> normal, fleet ratio barely moves
//   - a weekly-cadence tier on a day it does not pull        -> `unmeasured`, never `healthy`
//   - a provider that has never returned anything            -> no trailing baseline, no collapse
//   - an ongoing outage, re-paged at the same volume nightly -> escalates, then backs off
// ---------------------------------------------------------------------------

/** How to decide whether one snapshot of this provider actually carried data. */
export type YieldKind = "array" | "present"

export type YieldProvider = {
  /** `location_snapshots.provider` */
  provider: string
  /** Human name for the alert body. */
  label: string
  /** Top-level key inside `raw_data`. */
  path: string
  kind: YieldKind
  /**
   * A day with fewer snapshots than this is not judged at all. This is the weekly-cadence guard:
   * Starter pulls events and visibility on Mondays only, so five days out of seven a weekly
   * location legitimately has no row, and treating that as a zero would page ops every Tuesday.
   */
  minSnapshots: number
}

/**
 * The providers watched, with the shape check verified against prod rows on 2026-08-22 rather than
 * assumed from the type definitions:
 *
 *   dataforseo_google_events  raw_data.events               array
 *   seo_serp_keywords         raw_data.entries              array
 *   seo_ranked_keywords       raw_data.keywords             array
 *   review_sentiment          raw_data.themes               array
 *   google_places_profile     raw_data.profile              object
 *   google_hours              raw_data.weekdayDescriptions  array
 *
 * `firecrawl_menu` is deliberately ABSENT. Menu coverage has its own purpose-built instrumentation
 * (coverageRatio, MENU_MIN_COVERAGE_RATIO) that answers a harder question than "is it empty", and a
 * second overlapping alarm on the same data would double-page for one cause.
 */
export const YIELD_PROVIDERS: readonly YieldProvider[] = [
  { provider: "dataforseo_google_events", label: "Events", path: "events", kind: "array", minSnapshots: 3 },
  { provider: "seo_serp_keywords", label: "Search visibility (SERP)", path: "entries", kind: "array", minSnapshots: 3 },
  { provider: "seo_ranked_keywords", label: "Search visibility (ranked keywords)", path: "keywords", kind: "array", minSnapshots: 3 },
  { provider: "review_sentiment", label: "Review sentiment", path: "themes", kind: "array", minSnapshots: 3 },
  { provider: "google_places_profile", label: "Google profile", path: "profile", kind: "present", minSnapshots: 3 },
  { provider: "google_hours", label: "Google hours", path: "weekdayDescriptions", kind: "array", minSnapshots: 3 },
]

/** The jsonb config handed to the `snapshot_yield` SQL function. One definition, two consumers. */
export function yieldConfigPayload(
  providers: readonly YieldProvider[] = YIELD_PROVIDERS,
): Array<{ provider: string; path: string; kind: YieldKind }> {
  return providers.map((p) => ({ provider: p.provider, path: p.path, kind: p.kind }))
}

/** One provider-day, as returned by `snapshot_yield`. */
export type DayYield = { dateKey: string; snapshots: number; populated: number }

/**
 * `unmeasured` is NOT `healthy`, and the distinction is load-bearing. A day we could not judge must
 * never read as a day that was fine: that conflation is how a metric ends up reporting health it
 * never observed.
 */
export type ZeroYieldStatus = "healthy" | "unmeasured" | "collapsed" | "zero"

export type Escalation = "none" | "first" | "escalated"

export type ProviderYieldVerdict = {
  provider: string
  label: string
  status: ZeroYieldStatus
  /** The day being judged, or null when there is no row for it at all. */
  today: DayYield | null
  todayRatio: number | null
  /** Median populated-ratio over the trailing measured days, excluding today. Null if no baseline. */
  trailingMedianRatio: number | null
  /** Consecutive MEASURED days ending today with zero populated snapshots. Unmeasured days are
   *  skipped rather than breaking the streak, so a weekly provider still accrues one. */
  consecutiveZeroDays: number
  /** Newest measured day that carried data, which is what makes an alert actionable. */
  lastGoodDateKey: string | null
  /** True when today cleared after the previous measured day was zero or collapsed. */
  recovered: boolean
  shouldAlert: boolean
  escalation: Escalation
}

/** Below this fraction of its own trailing median ratio, a provider has collapsed even if not zero.
 *  Half is deliberately blunt: this is a smoke alarm, and a tighter threshold on a 5-location fleet
 *  would fire on one location's ordinary quiet day. */
const COLLAPSE_FACTOR = 0.5
/** A collapse verdict needs a baseline built from at least this many measured days, or the first
 *  quiet day of a brand-new provider reads as a collapse against nothing. */
const MIN_BASELINE_DAYS = 3

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

const ratio = (d: DayYield): number => (d.snapshots === 0 ? 0 : d.populated / d.snapshots)

/**
 * Should an ongoing zero re-page tonight?
 *
 * Night 1 alerts. Night 2 alerts LOUDER, because Bryan's requirement is that consecutive nights
 * escalate rather than repeat: "it should get louder rather than repeating at the same volume,
 * which is how alerts get filtered into a folder nobody reads."
 *
 * From night 3 it backs off to powers of two (4, 8, 16, ...). That keeps a long outage visible
 * without training everyone to ignore it, which matters more than it sounds: the failure this
 * ticket exists for was five consecutive silent nights, and an alarm people have muted is
 * indistinguishable from no alarm.
 */
export function shouldPageForStreak(consecutiveZeroDays: number): boolean {
  if (consecutiveZeroDays <= 0) return false
  if (consecutiveZeroDays <= 2) return true
  return (consecutiveZeroDays & (consecutiveZeroDays - 1)) === 0 // exact power of two
}

/**
 * Classify one provider from its recent days.
 *
 * `days` may arrive in any order and may have gaps. `asOfDateKey` names the day to judge; when it
 * is absent from `days` the verdict is `unmeasured` with `today: null`, which is the honest answer
 * and explicitly not `healthy`.
 */
export function classifyProviderYield(
  cfg: YieldProvider,
  days: readonly DayYield[],
  asOfDateKey: string,
): ProviderYieldVerdict {
  const desc = [...days].sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0))
  // Only days at or before the one being judged, so a backfill landing a future date_key cannot
  // change today's verdict.
  const upTo = desc.filter((d) => d.dateKey <= asOfDateKey)
  const measured = upTo.filter((d) => d.snapshots >= cfg.minSnapshots)

  const today = upTo.find((d) => d.dateKey === asOfDateKey) ?? null
  const todayMeasured = today && today.snapshots >= cfg.minSnapshots ? today : null

  const priorMeasured = measured.filter((d) => d.dateKey !== asOfDateKey)
  const trailingMedianRatio = priorMeasured.length >= MIN_BASELINE_DAYS
    ? median(priorMeasured.map(ratio))
    : null

  const lastGoodDateKey = measured.find((d) => d.populated > 0)?.dateKey ?? null

  // Consecutive zero streak over MEASURED days only: an unmeasured day (a weekly tier's Tuesday)
  // is skipped, not treated as a break, or a weekly provider could never accrue a second night.
  let consecutiveZeroDays = 0
  for (const d of measured) {
    if (d.populated === 0) consecutiveZeroDays++
    else break
  }

  const classify = (d: DayYield | null): ZeroYieldStatus => {
    if (!d) return "unmeasured"
    if (d.populated === 0) return "zero"
    if (trailingMedianRatio !== null && trailingMedianRatio > 0 && ratio(d) < COLLAPSE_FACTOR * trailingMedianRatio) {
      return "collapsed"
    }
    return "healthy"
  }

  const status = classify(todayMeasured)
  const prevStatus = classify(priorMeasured[0] ?? null)

  const recovered = status === "healthy" && (prevStatus === "zero" || prevStatus === "collapsed")

  // A zero pages on the streak schedule. A collapse pages only on the transition into it, because
  // a partial shortfall is a weaker signal and does not deserve a repeating alarm.
  const shouldAlert = status === "zero"
    ? shouldPageForStreak(consecutiveZeroDays)
    : status === "collapsed" && prevStatus !== "collapsed" && prevStatus !== "zero"

  const escalation: Escalation = !shouldAlert
    ? "none"
    : status === "zero" && consecutiveZeroDays >= 2
      ? "escalated"
      : "first"

  return {
    provider: cfg.provider,
    label: cfg.label,
    status,
    today,
    todayRatio: todayMeasured ? ratio(todayMeasured) : null,
    trailingMedianRatio,
    consecutiveZeroDays,
    lastGoodDateKey,
    recovered,
    shouldAlert,
    escalation,
  }
}

/**
 * One line an operator can act on without opening anything.
 *
 * The ticket is explicit that this is part of the deliverable, not polish: "Events returned zero
 * for 14/14 locations, second consecutive night, last good 2026-08-04" is actionable and "Pipeline
 * degraded" is not.
 */
export function describeVerdict(v: ProviderYieldVerdict): string {
  const n = v.today
  if (v.status === "zero") {
    const nights = v.consecutiveZeroDays === 1
      ? "first night"
      : `${v.consecutiveZeroDays} consecutive nights`
    const lastGood = v.lastGoodDateKey ? `last good ${v.lastGoodDateKey}` : "no good day in the window"
    const empty = (n?.snapshots ?? 0) - (n?.populated ?? 0)
    return `${v.label} returned zero for ${empty}/${n?.snapshots ?? 0} locations, ${nights}, ${lastGood}.`
  }
  if (v.status === "collapsed") {
    const pct = (r: number) => `${Math.round(r * 100)}%`
    return (
      `${v.label} yield fell to ${pct(v.todayRatio ?? 0)} of locations ` +
      `(${n?.populated ?? 0}/${n?.snapshots ?? 0}) against a trailing ${pct(v.trailingMedianRatio ?? 0)}.`
    )
  }
  if (v.status === "unmeasured") {
    return `${v.label} had too few snapshots to judge (${n?.snapshots ?? 0}), so it is unmeasured, not healthy.`
  }
  return `${v.label} is healthy (${n?.populated ?? 0}/${n?.snapshots ?? 0} locations carried data).`
}

// ── Loader ─────────────────────────────────────────────────────────────────
//
// Kept separate from every function above so all the judgement is pure and unit-testable. The DB
// touches exactly one thing: `snapshot_yield`, an aggregate that returns four small columns per
// (provider, day) instead of shipping raw_data to compute two integers.

import type { SB } from "@/lib/jobs/queue"

/** Trailing window. 10 days gives a weekly-cadence provider at least two measured Mondays, so it
 *  has a baseline at all, while staying short enough that a fortnight-old regime does not anchor
 *  today's median. */
export const YIELD_WINDOW_DAYS = 10

export type ZeroYieldReport = {
  asOfDateKey: string
  verdicts: ProviderYieldVerdict[]
  /** Set when the aggregate could not be read, so an empty `verdicts` means "we could not look"
   *  and never "everything is fine". Same lesson as ALT-745: the one signal built to make a silent
   *  outage loud must not report all-clear whenever it is blind. */
  readError?: string
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export async function detectZeroYield(
  sb: SB,
  opts: {
    nowMs?: number
    providers?: readonly YieldProvider[]
    windowDays?: number
  } = {},
): Promise<ZeroYieldReport> {
  const nowMs = opts.nowMs ?? Date.now()
  const providers = opts.providers ?? YIELD_PROVIDERS
  const windowDays = opts.windowDays ?? YIELD_WINDOW_DAYS
  const asOfDateKey = isoDay(nowMs)
  const since = isoDay(nowMs - windowDays * 86_400_000)

  const { data, error } = await sb.rpc("snapshot_yield", {
    p_config: yieldConfigPayload(providers),
    p_since: since,
  })

  if (error) {
    console.error(`[zero-yield] snapshot_yield failed, zero-yield detection is BLIND: ${error.message}`)
    return { asOfDateKey, verdicts: [], readError: error.message }
  }

  const byProvider = new Map<string, DayYield[]>()
  for (const row of (data ?? []) as Array<{
    provider: string
    date_key: string
    snapshots: number | string
    populated: number | string
  }>) {
    // bigint comes back as a string over PostgREST on some driver versions; coerce rather than
    // trusting the declared type, because `"0" === 0` is false and a string would read as populated.
    const day: DayYield = {
      dateKey: String(row.date_key).slice(0, 10),
      snapshots: Number(row.snapshots),
      populated: Number(row.populated),
    }
    const list = byProvider.get(row.provider)
    if (list) list.push(day)
    else byProvider.set(row.provider, [day])
  }

  return {
    asOfDateKey,
    verdicts: providers.map((cfg) =>
      classifyProviderYield(cfg, byProvider.get(cfg.provider) ?? [], asOfDateKey),
    ),
  }
}

/** The verdicts worth paging about tonight, worst first. */
export function alertableVerdicts(report: ZeroYieldReport): ProviderYieldVerdict[] {
  const rank = (v: ProviderYieldVerdict) => (v.status === "zero" ? 0 : 1)
  return report.verdicts
    .filter((v) => v.shouldAlert)
    .sort((a, b) => rank(a) - rank(b) || b.consecutiveZeroDays - a.consecutiveZeroDays)
}
