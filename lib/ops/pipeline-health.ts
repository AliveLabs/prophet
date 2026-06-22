// ---------------------------------------------------------------------------
// Pipeline health — "are the scheduled jobs actually running and completing?"
//
// Built after the 2026-06 silent stall: the durable queue (signal_jobs/pipeline_runs)
// produced ZERO runs for ~2 weeks because the Vercel cron schedule stopped firing
// (likely a billing/disable event), and NOTHING alerted — because every alerter was
// itself a Vercel cron, dark alongside the rest.
//
// This module computes a fleet-wide health verdict from data freshness + queue state.
// It is consumed by GET /api/health/pipeline, which is polled by an EXTERNAL watchdog
// (GitHub Actions) that lives outside Vercel — the only way to catch "all crons dark".
//
// Catches BOTH (a) a total blackout — no run/data/brief fleet-wide (the 2026-06 stall),
// and (b) a PARTIAL stall — a subset of recently-active locations stops getting fresh
// briefs while others keep going (the 2026-06-12 Raising Cane's "7 of 14" signature),
// which a fleet-wide MAX would mask.
//
// Split for testability: evaluatePipelineHealth() is PURE (verdict from signals + now);
// fetchPipelineSignals() does the I/O; detectPipelineHealth() composes the two.
// ---------------------------------------------------------------------------

import { detectDataForSeoHealth } from "@/lib/jobs/vendor-health"
import type { SB } from "@/lib/jobs/queue"

export type PipelineHealthStatus = "ok" | "degraded" | "down"

/** Raw signals the verdict is computed from (all already-fetched, no I/O here). */
export type PipelineSignals = {
  /** Most recent pipeline_runs row (worker ran a job). null = the queue has never run. */
  lastRunAt: string | null
  /** Most recent location_snapshots row (data landed). */
  lastDataAt: string | null
  /** Most recent daily_briefs row (a brief built). */
  lastBriefAt: string | null
  /** Recently-active locations (built a brief within the active window) whose NEWEST brief is now
   *  older than the stale threshold — i.e. a partial-fleet stall that the fleet-wide MAX hides. */
  staleLocations: number
  /** signal_jobs stuck in 'running' past the zombie window (timed out mid-job). */
  stuckJobs: number
  /** DISTINCT (location, pipeline) terminal failures within the stale window. Distinct so one
   *  chronically-broken pipeline retrying 3× doesn't inflate the count into daily alert noise. */
  failedJobsRecent: number
  /** signal_jobs 'queued' with scheduled_for well in the past — the worker isn't draining. */
  staleQueuedJobs: number
  /** DataForSEO fleet health (reused from the vendor-health detector). */
  vendorDown: boolean
  vendorPaymentRequired: boolean
}

export type PipelineHealthThresholds = {
  /** No run / no data / no brief within this many hours ⇒ a problem. Daily pipeline + a
   *  buffer for the 06:00 data / 08:00 brief schedule ⇒ 26h default (env STALE_PIPELINE_HOURS). */
  staleHours: number
  /** Failed distinct (location,pipeline) count within the window that escalates to degraded. */
  failedJobsAlert: number
  /** Number of stale recently-active locations that escalates to degraded (partial-stall). */
  staleLocationsAlert: number
}

export const DEFAULT_THRESHOLDS: PipelineHealthThresholds = {
  staleHours: 26,
  failedJobsAlert: 3,
  staleLocationsAlert: 2,
}

/** A location counts as "recently active" (and therefore expected to stay fresh) if it built a
 *  brief within this many days — comfortably exceeds the weekly-tier Monday cadence. */
export const RECENT_ACTIVE_DAYS = 8

export type PipelineHealthVerdict = {
  status: PipelineHealthStatus
  checkedAt: string
  /** Human-readable problems; empty when status is ok. */
  reasons: string[]
  lastRunAt: string | null
  lastDataAt: string | null
  lastBriefAt: string | null
  hoursSinceLastRun: number | null
  hoursSinceLastData: number | null
  hoursSinceLastBrief: number | null
  staleLocations: number
  stuckJobs: number
  failedJobsRecent: number
  staleQueuedJobs: number
  vendor: { down: boolean; paymentRequired: boolean }
  thresholds: PipelineHealthThresholds
}

const RANK: Record<PipelineHealthStatus, number> = { ok: 0, degraded: 1, down: 2 }

/** PURE: turn raw signals + the current time into a verdict. No I/O — fully unit-testable. */
export function evaluatePipelineHealth(
  s: PipelineSignals,
  nowMs: number,
  t: PipelineHealthThresholds = DEFAULT_THRESHOLDS,
): PipelineHealthVerdict {
  const ageHours = (iso: string | null): number | null => (iso == null ? null : (nowMs - new Date(iso).getTime()) / 3_600_000)
  const runAge = ageHours(s.lastRunAt)
  const dataAge = ageHours(s.lastDataAt)
  const briefAge = ageHours(s.lastBriefAt)

  const reasons: string[] = []
  let status: PipelineHealthStatus = "ok"
  const escalate = (to: PipelineHealthStatus) => {
    if (RANK[to] > RANK[status]) status = to
  }

  // DOWN — the scheduled pipeline isn't running at all (the silent-stall signature).
  if (s.lastRunAt == null) {
    reasons.push("No pipeline run on record — the worker queue has never run (crons dark?)")
    escalate("down")
  } else if (runAge != null && runAge > t.staleHours) {
    reasons.push(`No pipeline run in ${runAge.toFixed(1)}h (threshold ${t.staleHours}h) — the schedule may have stopped firing`)
    escalate("down")
  }
  if (s.lastDataAt == null) {
    reasons.push("No data snapshots on record")
    escalate("down")
  } else if (dataAge != null && dataAge > t.staleHours) {
    reasons.push(`No fresh data pulled in ${dataAge.toFixed(1)}h (threshold ${t.staleHours}h)`)
    escalate("down")
  }

  // DEGRADED — running, but not finishing the job cleanly (incl. a PARTIAL-fleet stall).
  if (s.lastBriefAt == null) {
    reasons.push("No briefs on record")
    escalate("degraded")
  } else if (briefAge != null && briefAge > t.staleHours) {
    reasons.push(`No brief built in ${briefAge.toFixed(1)}h (threshold ${t.staleHours}h)`)
    escalate("degraded")
  }
  if (s.staleLocations >= t.staleLocationsAlert) {
    reasons.push(`${s.staleLocations} recently-active location(s) have no fresh brief in ${t.staleHours}h (partial stall)`)
    escalate("degraded")
  }
  if (s.staleQueuedJobs > 0) {
    reasons.push(`${s.staleQueuedJobs} job(s) queued but not draining — the worker may be stalled`)
    escalate("degraded")
  }
  if (s.stuckJobs > 0) {
    reasons.push(`${s.stuckJobs} job(s) stuck 'running' past the zombie window (timed out mid-job)`)
    escalate("degraded")
  }
  if (s.failedJobsRecent >= t.failedJobsAlert) {
    reasons.push(`${s.failedJobsRecent} pipeline(s) failing across the fleet in the last ${t.staleHours}h`)
    escalate("degraded")
  }
  if (s.vendorDown) {
    reasons.push(`DataForSEO is failing fleet-wide${s.vendorPaymentRequired ? " (out of credits — refill the account)" : ""}`)
    escalate("degraded")
  }

  return {
    status,
    checkedAt: new Date(nowMs).toISOString(),
    reasons,
    lastRunAt: s.lastRunAt,
    lastDataAt: s.lastDataAt,
    lastBriefAt: s.lastBriefAt,
    hoursSinceLastRun: runAge,
    hoursSinceLastData: dataAge,
    hoursSinceLastBrief: briefAge,
    staleLocations: s.staleLocations,
    stuckJobs: s.stuckJobs,
    failedJobsRecent: s.failedJobsRecent,
    staleQueuedJobs: s.staleQueuedJobs,
    vendor: { down: s.vendorDown, paymentRequired: s.vendorPaymentRequired },
    thresholds: t,
  }
}

/** I/O: gather the raw freshness + queue signals from the DB. */
export async function fetchPipelineSignals(sb: SB, nowMs: number, staleHours: number): Promise<PipelineSignals> {
  const staleCutoffMs = nowMs - staleHours * 3_600_000
  const sinceIso = new Date(staleCutoffMs).toISOString()
  const zombieIso = new Date(nowMs - 20 * 60_000).toISOString()
  // Grace MUST exceed the queue's max retry backoff (3600s = 60m, see backoffSeconds) so a
  // legitimately-requeued job sitting at the backoff boundary isn't mistaken for a stalled worker.
  const queuedGraceIso = new Date(nowMs - 120 * 60_000).toISOString()
  const recentActiveIso = new Date(nowMs - RECENT_ACTIVE_DAYS * 24 * 3_600_000).toISOString()

  const [run, data, brief, recentBriefs, stuck, failedRows, staleQ, vendor] = await Promise.all([
    sb.from("pipeline_runs").select("started_at, finished_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("location_snapshots").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("daily_briefs").select("generated_at").order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    // Per-location brief freshness (partial-stall detection): newest brief per recently-active location.
    sb.from("daily_briefs").select("location_id, generated_at").gte("generated_at", recentActiveIso).order("generated_at", { ascending: false }),
    sb.from("signal_jobs").select("id", { count: "exact", head: true }).eq("status", "running").lt("claimed_at", zombieIso),
    // Distinct (location, pipeline) failures — fetch the rows and de-dup in JS (PostgREST can't distinct-count).
    sb.from("signal_jobs").select("location_id, pipeline").eq("status", "failed").gte("updated_at", sinceIso),
    sb.from("signal_jobs").select("id", { count: "exact", head: true }).eq("status", "queued").lt("scheduled_for", queuedGraceIso),
    detectDataForSeoHealth(sb, { nowMs }),
  ])

  // Newest brief per location (rows are ordered newest-first, so first seen per location wins).
  const newestBriefByLocation = new Map<string, string>()
  for (const r of recentBriefs.data ?? []) {
    if (r.location_id && !newestBriefByLocation.has(r.location_id)) newestBriefByLocation.set(r.location_id, r.generated_at)
  }
  let staleLocations = 0
  for (const ts of newestBriefByLocation.values()) {
    if (new Date(ts).getTime() < staleCutoffMs) staleLocations++
  }

  const failedKeys = new Set((failedRows.data ?? []).map((r) => `${r.location_id}|${r.pipeline}`))

  return {
    lastRunAt: (run.data?.finished_at ?? run.data?.started_at) ?? null,
    lastDataAt: data.data?.created_at ?? null,
    lastBriefAt: brief.data?.generated_at ?? null,
    staleLocations,
    stuckJobs: stuck.count ?? 0,
    failedJobsRecent: failedKeys.size,
    staleQueuedJobs: staleQ.count ?? 0,
    vendorDown: vendor.down,
    vendorPaymentRequired: vendor.paymentRequired,
  }
}

/** Compose: fetch the signals, then evaluate. Read-only; safe to call from a health probe. */
export async function detectPipelineHealth(
  sb: SB,
  opts: { nowMs?: number; staleHours?: number } = {},
): Promise<PipelineHealthVerdict> {
  const nowMs = opts.nowMs ?? Date.now()
  const staleHours = opts.staleHours ?? (Number(process.env.STALE_PIPELINE_HOURS) || DEFAULT_THRESHOLDS.staleHours)
  const thresholds: PipelineHealthThresholds = { ...DEFAULT_THRESHOLDS, staleHours }
  const signals = await fetchPipelineSignals(sb, nowMs, staleHours)
  return evaluatePipelineHealth(signals, nowMs, thresholds)
}
