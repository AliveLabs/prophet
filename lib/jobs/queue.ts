// ---------------------------------------------------------------------------
// Durable orchestration queue (Spine rewrite · Phase 3)
//
// One signal_jobs row per (location, pipeline). The daily cron enqueues; a
// cron-driven worker claims (concurrency-safe via claim_signal_jobs), runs one
// pipeline per job, and records an honest pipeline_runs outcome. Failures retry
// with exponential backoff up to max_attempts. No single invocation must finish
// everything — this is what replaces the fire-and-forget 300s refresh_all.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"

export type SB = SupabaseClient<Database>
export type SignalJob = Database["public"]["Tables"]["signal_jobs"]["Row"]

export type PipelineOutcome =
  | "fresh"
  | "served_stale"
  | "dormant"
  | "no_data"
  | "partial"
  | "failed"
  | "skipped"

// Pipelines the daily orchestration enqueues. `photos` is heavy (Gemini Vision) and
// weekly — enqueued only on its day. `insights` runs last (depends on the others).
export const DAILY_PIPELINES = ["content", "visibility", "events", "weather", "busy_times", "social", "insights"] as const
export const WEEKLY_PIPELINES = ["photos"] as const

/** Pull scope stored on each job's `cursor` and applied by the worker. */
export type PullScope = { mode?: "first_run" | "daily" | "weekly" | "adhoc"; force?: boolean; platforms?: string[] }

export async function enqueueRun(
  sb: SB,
  args: {
    runId: string
    organizationId: string
    locationId: string
    pipelines: readonly string[]
    /** Optional delay (e.g. enqueue `insights` after the data pipelines have a head start). */
    delaySeconds?: number
    /** Cadence mode / forced refresh / platform filter — carried per job for the worker. */
    scope?: PullScope
  }
): Promise<number> {
  if (args.pipelines.length === 0) return 0
  const scheduledFor = args.delaySeconds
    ? new Date(Date.now() + args.delaySeconds * 1000).toISOString()
    : undefined
  const rows = args.pipelines.map((pipeline) => ({
    run_id: args.runId,
    organization_id: args.organizationId,
    location_id: args.locationId,
    pipeline,
    ...(scheduledFor ? { scheduled_for: scheduledFor } : {}),
    ...(args.scope ? { cursor: args.scope as Database["public"]["Tables"]["signal_jobs"]["Insert"]["cursor"] } : {}),
  }))
  const { error } = await sb.from("signal_jobs").insert(rows)
  if (error) throw error
  return rows.length
}

// ── Pull sequencing modes ───────────────────────────────────────────────────
// All four modes flow through the SAME queue + worker (bounded, observable):

const FIRST_RUN_DATA = ["content", "visibility", "events", "weather", "busy_times", "social", "photos"] as const
const ADHOC_LOCATION_DATA = ["content", "visibility", "events", "weather", "busy_times", "social"] as const

/** First-time onboarding pull: everything once (force = ignore cadence), insights after a head start. */
export async function enqueueFirstRun(sb: SB, args: { organizationId: string; locationId: string; runId?: string }): Promise<number> {
  // Idempotent: a "first run" happens once per location. If this location already
  // has signal_jobs (a prior first-run or daily cycle), skip — re-running onboarding
  // (an admin re-opening a demo's setup, or a double-submit) must not double-enqueue
  // the whole pipeline. After a data clear (jobs deleted) it correctly runs again.
  const { count: existing } = await sb
    .from("signal_jobs")
    .select("id", { count: "exact", head: true })
    .eq("location_id", args.locationId)
  if ((existing ?? 0) > 0) return 0

  const runId = args.runId ?? crypto.randomUUID()
  let n = await enqueueRun(sb, { runId, organizationId: args.organizationId, locationId: args.locationId, pipelines: FIRST_RUN_DATA, scope: { mode: "first_run", force: true } })
  n += await enqueueRun(sb, { runId, organizationId: args.organizationId, locationId: args.locationId, pipelines: ["insights"], delaySeconds: 15 * 60, scope: { mode: "first_run" } })
  return n
}

/** Ad-hoc "refresh this business" — all data signals for one location (forced by default). */
export async function enqueueAdhocLocation(sb: SB, args: { organizationId: string; locationId: string; pipelines?: readonly string[]; force?: boolean }): Promise<number> {
  const runId = crypto.randomUUID()
  let n = await enqueueRun(sb, { runId, organizationId: args.organizationId, locationId: args.locationId, pipelines: args.pipelines ?? ADHOC_LOCATION_DATA, scope: { mode: "adhoc", force: args.force ?? true } })
  n += await enqueueRun(sb, { runId, organizationId: args.organizationId, locationId: args.locationId, pipelines: ["insights"], delaySeconds: 5 * 60, scope: { mode: "adhoc" } })
  return n
}

/** Ad-hoc "refresh just <network(s)>" — social for the given platforms only (forced by default). */
export async function enqueueAdhocPlatform(sb: SB, args: { organizationId: string; locationId: string; platforms: string[]; force?: boolean }): Promise<number> {
  const runId = crypto.randomUUID()
  let n = await enqueueRun(sb, { runId, organizationId: args.organizationId, locationId: args.locationId, pipelines: ["social"], scope: { mode: "adhoc", force: args.force ?? true, platforms: args.platforms } })
  n += await enqueueRun(sb, { runId, organizationId: args.organizationId, locationId: args.locationId, pipelines: ["insights"], delaySeconds: 5 * 60, scope: { mode: "adhoc" } })
  return n
}

/**
 * Enqueue a `brief` build unless one is already queued/running or was created
 * recently (default 2h window — covers a failed-and-retrying job without
 * letting observers re-enqueue in a loop). The failsafe primitive behind the
 * self-healing /home empty state and the build-brief cron enqueuer
 * (2026-06-12 Raising Cane's incident: the inline build-all cron hit its 800s
 * ceiling at ~8 locations and silently skipped the rest).
 */
export async function enqueueBriefIfMissing(
  sb: SB,
  args: { organizationId: string; locationId: string; recentWindowMinutes?: number }
): Promise<"enqueued" | "skipped"> {
  const windowMs = (args.recentWindowMinutes ?? 120) * 60 * 1000
  const { data: latest } = await sb
    .from("signal_jobs")
    .select("status, created_at")
    .eq("location_id", args.locationId)
    .eq("pipeline", "brief")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest) {
    const active = latest.status === "queued" || latest.status === "running"
    const recent = new Date(latest.created_at).getTime() > Date.now() - windowMs
    if (active || recent) return "skipped"
  }

  await enqueueRun(sb, {
    runId: crypto.randomUUID(),
    organizationId: args.organizationId,
    locationId: args.locationId,
    pipelines: ["brief"],
  })
  return "enqueued"
}

/** Concurrency-safe claim of up to `batch` due jobs (atomic flip to running). */
export async function claimJobs(sb: SB, batch: number): Promise<SignalJob[]> {
  const { data, error } = await sb.rpc("claim_signal_jobs", { batch })
  if (error) throw error
  return (data ?? []) as SignalJob[]
}

/** Exponential backoff (seconds) for retry N: 60, 120, 240, … capped at 1h. */
export function backoffSeconds(attempt: number): number {
  return Math.min(3600, 60 * 2 ** Math.max(0, attempt - 1))
}

// ── Worker time budget (don't start a job we can't finish) ───────────────────
// A worker invocation has maxDuration=800s. Running a slow pipeline (content
// ~334s avg, brief ~271s, visibility ~188s observed) as the 2nd+ job in a batch
// can overrun the cap → the row is left 'running' → zombie-reclaimed 20min later
// → staleQueued → watchdog "degraded". So the worker estimates each job's cost
// and DEFERS (immediately requeues, no attempt burned) any job that can't finish
// in the remaining budget. The first job of an invocation always runs (a fresh
// invocation has the full budget; forward progress beats deferring forever).
export const WORKER_BUDGET_MS = 800_000
export const WORKER_SAFETY_MARGIN_MS = 90_000

// Conservative per-pipeline runtime estimates — above observed averages, with
// tail headroom (a job runs longer on a signal-rich location than the mean).
const PIPELINE_TIME_ESTIMATE_MS: Record<string, number> = {
  content: 450_000,
  insights: 420_000,
  photos: 420_000,
  brief: 380_000,
  visibility: 280_000,
  social: 220_000,
  events: 200_000,
  busy_times: 150_000,
  weather: 90_000,
}
const DEFAULT_PIPELINE_TIME_ESTIMATE_MS = 320_000

export function estimatePipelineMs(pipeline: string): number {
  return PIPELINE_TIME_ESTIMATE_MS[pipeline] ?? DEFAULT_PIPELINE_TIME_ESTIMATE_MS
}

/**
 * Should the worker DEFER (not start) this job to avoid overrunning maxDuration?
 * Pure decision so it's unit-testable. The first job of an invocation
 * (`executed === 0`) always runs — a fresh invocation has the full budget, and
 * forward progress on a slow pipeline beats deferring it forever.
 */
export function shouldDeferJob(args: { pipeline: string; elapsedMs: number; executed: number }): boolean {
  if (args.executed === 0) return false
  const remainingMs = WORKER_BUDGET_MS - args.elapsedMs - WORKER_SAFETY_MARGIN_MS
  return remainingMs < estimatePipelineMs(args.pipeline)
}

// ── Brief data-readiness gate (ENG-H3) ───────────────────────────────────────
// The 06:00 data cron enqueues per-pipeline jobs; the 08:00 build-brief cron enqueues briefs. At
// scale the worker may not have drained the data jobs by 08:00, so a brief built on the wall clock
// can use stale/half-loaded signals (the failure class the spine rewrite was built to kill). Fix:
// a brief WAITS (defers, no attempt burned) until its location's data jobs settle — bounded by a
// max wait so a permanently-stuck data job can never starve the brief.

// The daily data run starts at 06:00 and the brief is enqueued at 08:00 (already +2h of headroom);
// 90 min of additional brief-wait past its own enqueue is ample for a slow drain, and bounds the
// worst case (build on whatever's there) for a wedged data job.
export const BRIEF_MAX_DATA_WAIT_MS = 90 * 60 * 1000

/** True if any non-brief data/insights job for this location is still queued or running. Fails
 *  OPEN (returns false) on a read error so a transient blip can't stall the brief indefinitely. */
export async function locationHasPendingDataJobs(sb: SB, locationId: string): Promise<boolean> {
  const { count, error } = await sb
    .from("signal_jobs")
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId)
    .neq("pipeline", "brief")
    .in("status", ["queued", "running"])
  if (error) {
    console.warn(`[queue] pending-data-jobs check failed for ${locationId}; not waiting:`, error.message)
    return false
  }
  return (count ?? 0) > 0
}

/**
 * Should a claimed brief job DEFER to wait for its location's data to settle? Pure (unit-testable).
 * Waits only while data is still pending AND the brief hasn't already waited past the max window.
 */
export function briefShouldWaitForData(args: { pending: boolean; briefAgeMs: number }): boolean {
  return args.pending && args.briefAgeMs < BRIEF_MAX_DATA_WAIT_MS
}

export async function finishJob(
  sb: SB,
  job: SignalJob,
  ok: boolean,
  lastError?: string
): Promise<"done" | "failed" | "requeued"> {
  const now = new Date().toISOString()
  if (ok) {
    await sb.from("signal_jobs").update({ status: "done", updated_at: now, last_error: null }).eq("id", job.id)
    return "done"
  }
  if (job.attempts >= job.max_attempts) {
    await sb.from("signal_jobs").update({ status: "failed", last_error: lastError ?? "failed", updated_at: now }).eq("id", job.id)
    return "failed"
  }
  const scheduledFor = new Date(Date.now() + backoffSeconds(job.attempts) * 1000).toISOString()
  await sb
    .from("signal_jobs")
    .update({ status: "queued", scheduled_for: scheduledFor, last_error: lastError ?? null, updated_at: now })
    .eq("id", job.id)
  return "requeued"
}

/**
 * Requeue a claimed-but-not-run job immediately (budget defer — see
 * `shouldDeferJob`). The claim already incremented `attempts`
 * (claim_signal_jobs) — give it back, since the job never ran, so a deferred job
 * is never pushed toward `max_attempts`. Due now → the next worker tick (with a
 * fresh 800s budget) picks it up.
 */
export async function deferJob(sb: SB, job: SignalJob): Promise<"deferred"> {
  const now = new Date().toISOString()
  await sb
    .from("signal_jobs")
    // claimed_at: null — the job never ran, so don't leave a stale claim timestamp on the
    // requeued row (keeps it cleanly distinct from a genuine in-flight/zombie 'running' row).
    .update({ status: "queued", scheduled_for: now, claimed_at: null, attempts: Math.max(0, job.attempts - 1), updated_at: now })
    .eq("id", job.id)
  return "deferred"
}

/** Record an honest run outcome (not just "completed"). */
export async function recordRun(
  sb: SB,
  args: {
    runId: string
    locationId: string
    competitorId?: string | null
    pipeline: string
    outcome: PipelineOutcome
    reason?: string
    signals?: Record<string, unknown>
    startedAt: string
  }
): Promise<void> {
  await sb.from("pipeline_runs").insert({
    run_id: args.runId,
    location_id: args.locationId,
    competitor_id: args.competitorId ?? null,
    pipeline: args.pipeline,
    outcome: args.outcome,
    reason: args.reason ?? null,
    signals: (args.signals ?? {}) as Database["public"]["Tables"]["pipeline_runs"]["Insert"]["signals"],
    started_at: args.startedAt,
    finished_at: new Date().toISOString(),
  })
}
