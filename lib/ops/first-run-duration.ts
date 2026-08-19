// ---------------------------------------------------------------------------
// First-run duration — "how long does a new operator actually wait for their first brief?"
//
// ALT-676. The marketing site claims a first read in about 15 minutes. On 2026-08-18 trying to
// verify that from history produced ONE usable sample, because the obvious anchor was wrong. Bryan's
// call: stop re-pricing the promise off archaeology, measure real onboardings as they happen.
//
// ── THE ANCHOR, and why the two obvious candidates are both wrong ──────────────────────────
//
//   locations.created_at          Set when the operator CONFIRMS their business, so it includes all
//                                their wizard time. On 407 BBQ that was 12 extra minutes of a human
//                                reading the screen. Measuring it makes the product look slow for
//                                being read carefully.
//
//   min(pipeline_runs.started_at) Data pulls can begin DURING onboarding (competitor discovery kicks
//                                them), so this can predate setup completion entirely.
//
//   ✅ the `starter` job          `enqueueFirstRun` (lib/jobs/queue.ts) enqueues FIRST_RUN_STARTER as
//                                its first job, and `completeOnboarding` is what calls it. So
//                                `starter.started_at` is exactly the moment the operator stopped
//                                participating and the machine took over.
//
// END POINT: the first `daily_briefs.generated_at` at or after that instant.
//
// ── WORK vs IDLE, which is the part that pays for this module ───────────────────────────────
// A first run is not busy for its whole duration. `shouldDeferJob` makes `insights` un-startable
// past 6.0 min into a drain call and `brief` un-startable mid-call at all, so each needs a FRESH
// invocation, and until PR #242 the tail of the run fell back to the five-minute worker cron.
//
// So: idle = wall clock MINUS the union of every pipeline run's [started_at, finished_at] inside the
// window. Union, not sum, because first-run drains run at concurrency 2 and overlapping runs would
// otherwise double-count as "work" and report negative idle.
//
// Validated against prod 2026-08-19: this reproduces 4.3 min idle out of 21.2 for the run that was
// measured by hand in the earlier session, and surfaced a second cold start (22.3 min, 5.6 idle)
// that the by-hand pass had missed.
//
// ── PRE-WARMED RUNS ARE NOT COLD STARTS ────────────────────────────────────────────────────
// If the operator was slow in the wizard, their data pulls can finish BEFORE `starter` fires. That
// run measures much faster for a reason that has nothing to do with our throughput: 407 BBQ came in
// at 13.6 min with 5 pulls already banked. Averaging that into the headline would let a slow operator
// flatter us. They are reported as a separate series, never blended.
//
// ── WHY THIS COMPUTES ON READ INSTEAD OF PERSISTING ────────────────────────────────────────
// The ticket allows either. Read-time won because the raw rows already exist, the volume is tiny
// (one starter run per onboarding, ever), and it needs no migration — and migrations do not
// auto-apply here (ALT-677: `review_watch_events` sat merged-but-missing in prod for four days while
// dependent code failed silently). A metric that cannot be missing is worth more than a fast one.
// ---------------------------------------------------------------------------

import type { SB } from "@/lib/jobs/queue"

/** Pipelines that pull external data. Used only to spot a PRE-WARMED run. */
export const FIRST_RUN_DATA_PIPELINES = [
  "content",
  "visibility",
  "events",
  "weather",
  "busy_times",
  "social",
  "photos",
] as const

/** How far back the report looks. Generous: onboardings are rare and every one is worth seeing. */
export const FIRST_RUN_LOOKBACK_DAYS = 90

export type Interval = { startMs: number; endMs: number }

export type FirstRunSample = {
  locationId: string
  locationName: string | null
  /** `starter.started_at` — the anchor. */
  startedAt: string
  /** First brief at or after the anchor; null while the run has not produced one yet. */
  briefAt: string | null
  /** Anchor → first brief. null until the brief lands. */
  totalMs: number | null
  /** Union of pipeline-run intervals inside the window. */
  workMs: number | null
  /** totalMs − workMs: time nobody was working, i.e. waiting for an invocation. */
  idleMs: number | null
  /** Data pulls that had already FINISHED before the anchor fired. */
  preWarmedPulls: number
  /** True when any pull finished before the anchor, so this is not comparable to a cold start. */
  preWarmed: boolean
}

export type FirstRunStats = {
  n: number
  latestMs: number | null
  medianMs: number | null
  p95Ms: number | null
  medianIdleMs: number | null
  /** Share (0..1) of the median run spent idle. Null when there is nothing to divide. */
  idleShare: number | null
}

export type FirstRunReport = {
  /** Cold starts, newest first. The headline series — this is what the 15-minute claim is about. */
  coldStarts: FirstRunSample[]
  /** Runs whose data was already partly pulled. Reported, never blended into the headline. */
  preWarmed: FirstRunSample[]
  /** Anchored but no brief yet: either in flight right now, or it never finished. */
  incomplete: FirstRunSample[]
  cold: FirstRunStats
}

/**
 * PURE: total covered time across possibly-overlapping intervals.
 *
 * Overlap is normal, not a data error: the first-run drain runs at concurrency 2. Summing durations
 * instead of unioning them would over-count work and can report NEGATIVE idle, which is how a
 * latency metric quietly becomes a reassuring one.
 */
export function unionBusyMs(intervals: readonly Interval[]): number {
  const valid = intervals
    .filter((i) => Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs)
  if (valid.length === 0) return 0

  let total = 0
  let curStart = valid[0].startMs
  let curEnd = valid[0].endMs
  for (const i of valid.slice(1)) {
    if (i.startMs > curEnd) {
      total += curEnd - curStart
      curStart = i.startMs
      curEnd = i.endMs
    } else if (i.endMs > curEnd) {
      curEnd = i.endMs
    }
  }
  return total + (curEnd - curStart)
}

/** PURE: nearest-rank percentile in ms. p in 0..1. Returns null on an empty sample. */
export function percentileMs(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[idx]
}

/** PURE: fold cold-start samples into the headline stats. Incomplete runs are excluded. */
export function summarizeColdStarts(samples: readonly FirstRunSample[]): FirstRunStats {
  const complete = samples.filter((s) => s.totalMs != null)
  const totals = complete.map((s) => s.totalMs as number)
  const idles = complete.map((s) => s.idleMs ?? 0)
  const medianMs = percentileMs(totals, 0.5)
  const medianIdleMs = percentileMs(idles, 0.5)
  return {
    n: complete.length,
    // Samples arrive newest-first, so the first COMPLETE one is the latest measured run.
    latestMs: complete.length > 0 ? (complete[0].totalMs as number) : null,
    medianMs,
    p95Ms: percentileMs(totals, 0.95),
    medianIdleMs,
    idleShare: medianMs != null && medianMs > 0 && medianIdleMs != null ? medianIdleMs / medianMs : null,
  }
}

/**
 * PURE: build one sample from an anchor plus that location's runs and briefs.
 *
 * `runs` and `briefs` may cover the whole location history — this clips them to the window itself,
 * so callers can fetch once per location rather than per anchor.
 */
export function buildFirstRunSample(args: {
  locationId: string
  locationName: string | null
  starterStartedAt: string
  runs: ReadonlyArray<{ pipeline: string; started_at: string; finished_at: string | null }>
  briefTimes: readonly string[]
}): FirstRunSample {
  const t0 = new Date(args.starterStartedAt).getTime()

  const briefMs = args.briefTimes
    .map((b) => new Date(b).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= t0)
    .sort((a, b) => a - b)
  const t1 = briefMs.length > 0 ? briefMs[0] : null

  // A pull that FINISHED before the anchor means the operator's data was already being gathered
  // while they were still in the wizard. That is a faster run for a reason we did not earn.
  const dataPipelines = new Set<string>(FIRST_RUN_DATA_PIPELINES)
  const preWarmedPulls = args.runs.filter(
    (r) =>
      dataPipelines.has(r.pipeline) &&
      r.finished_at != null &&
      new Date(r.finished_at).getTime() < t0,
  ).length

  if (t1 == null) {
    return {
      locationId: args.locationId,
      locationName: args.locationName,
      startedAt: args.starterStartedAt,
      briefAt: null,
      totalMs: null,
      workMs: null,
      idleMs: null,
      preWarmedPulls,
      preWarmed: preWarmedPulls > 0,
    }
  }

  // Clip every overlapping run to the window. A run with no finished_at is treated as instantaneous
  // rather than as running-until-now: an unfinished row is usually a crashed job, and stretching it
  // to the present would silently erase the idle time we are here to find.
  const clipped: Interval[] = []
  for (const r of args.runs) {
    const s = new Date(r.started_at).getTime()
    const f = r.finished_at != null ? new Date(r.finished_at).getTime() : s
    if (!Number.isFinite(s)) continue
    if (s >= t1 || f <= t0) continue
    clipped.push({ startMs: Math.max(s, t0), endMs: Math.min(Number.isFinite(f) ? f : s, t1) })
  }

  const totalMs = t1 - t0
  const workMs = unionBusyMs(clipped)
  return {
    locationId: args.locationId,
    locationName: args.locationName,
    startedAt: args.starterStartedAt,
    briefAt: new Date(t1).toISOString(),
    totalMs,
    workMs,
    idleMs: Math.max(0, totalMs - workMs),
    preWarmedPulls,
    preWarmed: preWarmedPulls > 0,
  }
}

/** I/O: read every anchored first run in the lookback window and report it. */
export async function fetchFirstRunReport(
  sb: SB,
  opts: { nowMs?: number; lookbackDays?: number } = {},
): Promise<FirstRunReport> {
  const nowMs = opts.nowMs ?? Date.now()
  const lookbackDays = opts.lookbackDays ?? FIRST_RUN_LOOKBACK_DAYS
  const sinceIso = new Date(nowMs - lookbackDays * 24 * 3_600_000).toISOString()

  const { data: anchors } = await sb
    .from("pipeline_runs")
    .select("location_id, started_at")
    .eq("pipeline", "starter")
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })

  const anchorRows = (anchors ?? []).filter(
    (a): a is { location_id: string; started_at: string } => a.location_id != null && a.started_at != null,
  )
  if (anchorRows.length === 0) {
    return { coldStarts: [], preWarmed: [], incomplete: [], cold: summarizeColdStarts([]) }
  }

  const locationIds = [...new Set(anchorRows.map((a) => a.location_id))]

  const [runsRes, briefsRes, locsRes] = await Promise.all([
    sb.from("pipeline_runs").select("location_id, pipeline, started_at, finished_at").in("location_id", locationIds),
    sb.from("daily_briefs").select("location_id, generated_at").in("location_id", locationIds),
    sb.from("locations").select("id, name").in("id", locationIds),
  ])

  const runsByLocation = new Map<string, Array<{ pipeline: string; started_at: string; finished_at: string | null }>>()
  for (const r of runsRes.data ?? []) {
    if (!r.location_id || !r.started_at || !r.pipeline) continue
    const list = runsByLocation.get(r.location_id) ?? []
    list.push({ pipeline: r.pipeline, started_at: r.started_at, finished_at: r.finished_at ?? null })
    runsByLocation.set(r.location_id, list)
  }

  const briefsByLocation = new Map<string, string[]>()
  for (const b of briefsRes.data ?? []) {
    if (!b.location_id || !b.generated_at) continue
    const list = briefsByLocation.get(b.location_id) ?? []
    list.push(b.generated_at)
    briefsByLocation.set(b.location_id, list)
  }

  const nameById = new Map<string, string | null>()
  for (const l of locsRes.data ?? []) if (l.id) nameById.set(l.id, l.name ?? null)

  const samples = anchorRows.map((a) =>
    buildFirstRunSample({
      locationId: a.location_id,
      locationName: nameById.get(a.location_id) ?? null,
      starterStartedAt: a.started_at,
      runs: runsByLocation.get(a.location_id) ?? [],
      briefTimes: briefsByLocation.get(a.location_id) ?? [],
    }),
  )

  const incomplete = samples.filter((s) => s.totalMs == null)
  const complete = samples.filter((s) => s.totalMs != null)
  const coldStarts = complete.filter((s) => !s.preWarmed)
  const preWarmed = complete.filter((s) => s.preWarmed)

  return { coldStarts, preWarmed, incomplete, cold: summarizeColdStarts(coldStarts) }
}
