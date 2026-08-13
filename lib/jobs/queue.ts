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
    /** Retry ceiling. Omitted = the column default (3). Set to 1 for a job whose retry would COST
     *  money rather than recover value (the starter insight: one producer call per signup, and the
     *  real brief is already on its way if it fails). */
    maxAttempts?: number
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
    ...(args.maxAttempts !== undefined ? { max_attempts: args.maxAttempts } : {}),
    ...(args.scope ? { cursor: args.scope as Database["public"]["Tables"]["signal_jobs"]["Insert"]["cursor"] } : {}),
  }))
  const { error } = await sb.from("signal_jobs").insert(rows)
  if (error) throw error
  return rows.length
}

// ── Pull sequencing modes ───────────────────────────────────────────────────
// All four modes flow through the SAME queue + worker (bounded, observable):

/** The DATA pulls a first run performs. Exported because the first-run insights readiness gate
 *  (below) and the scoped first-run drain both need to know exactly this set. */
export const FIRST_RUN_DATA = ["content", "visibility", "events", "weather", "busy_times", "social", "photos"] as const
const ADHOC_LOCATION_DATA = ["content", "visibility", "events", "weather", "busy_times", "social"] as const

/** The starter-insight job (beta rescue 3.1). Enqueued FIRST on a first run so `claim_signal_jobs`
 *  (order by created_at) reaches it before the data pulls: it builds the partial dossier and runs
 *  ONE low-effort producer, so the operator holds a real insight in minutes. First-run only. */
export const FIRST_RUN_STARTER = "starter"

/** First-time onboarding pull: the starter insight first, then every data pull once
 *  (force = ignore cadence), then insights — readiness-gated by the worker, not delayed by a timer. */
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
  // Three separate inserts, in this order, ON PURPOSE: rows inside one INSERT share a created_at,
  // and claim_signal_jobs orders by created_at, so separate statements are what give the starter a
  // claim ordering ahead of the data pulls.
  // maxAttempts 1: the starter's cost IS a producer call, so a retry would double the spend to
  // recover an artifact the real brief supersedes anyway. One shot, then let the brief do its job.
  let n = await enqueueRun(sb, { runId, organizationId: args.organizationId, locationId: args.locationId, pipelines: [FIRST_RUN_STARTER], scope: { mode: "first_run" }, maxAttempts: 1 })
  n += await enqueueRun(sb, { runId, organizationId: args.organizationId, locationId: args.locationId, pipelines: FIRST_RUN_DATA, scope: { mode: "first_run", force: true } })
  // NO delaySeconds. This used to be `delaySeconds: 15 * 60`. That timer existed to stop the
  // insights job running against an EMPTY dossier: it reads the competitor snapshots the content
  // and visibility pipelines write and the events snapshot the events pipeline writes, so a run at
  // t=0 would diff against nothing, write baseline-only rows, and burn its narrative model call on
  // a dossier with no signal in it. That is a READINESS problem, and 15 minutes was a guess at it:
  // on a fast location it wasted 15 minutes, and on a slow one it fired early anyway. The worker
  // now DEFERS a first-run insights job until this location's data pulls have settled
  // (`firstRunInsightsShouldWait`), bounded by FIRST_RUN_INSIGHTS_MAX_WAIT_MS so a wedged pull can
  // never starve it. Same protection, no fixed floor.
  n += await enqueueRun(sb, { runId, organizationId: args.organizationId, locationId: args.locationId, pipelines: ["insights"], scope: { mode: "first_run" } })
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
  args: {
    organizationId: string
    locationId: string
    recentWindowMinutes?: number
    /** Delay worker pickup (scheduled_for = now + delay). The build-brief cron staggers a zone's
     *  locations a few minutes apart so one zone's 3 AM doesn't build every brief at once. */
    delaySeconds?: number
  }
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
    ...(args.delaySeconds && args.delaySeconds > 0 ? { delaySeconds: args.delaySeconds } : {}),
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

// Per-pipeline runtime estimates. These exist for ONE decision: shouldDeferJob asking
// "can this job finish in the budget I have left?" So the right value is a pessimistic
// bound (observed max + headroom), NOT an average — an estimate below the real tail lets
// the worker start a job that overruns maxDuration, which leaves the row 'running', waits
// out the 20-minute zombie reclaim, and re-runs the whole pipeline. That is wasted spend
// and a brief that lands late.
//
// Recalibrated 2026-08-03 against 36h of prod signal_jobs (118 completed jobs, 0 retries),
// measuring claimed_at -> updated_at. Observed avg / max per pipeline:
//   brief 409s / 719s · content 302s / 425s · visibility 277s / 389s · insights 118s / 302s
//   photos 85s / 173s · events 79s / 380s · social 79s / 265s · busy_times 76s / 341s
//   weather 50s / 196s
// Note how far the tails sit above the means (events 79s avg, 380s max) — the means are
// useless for this decision. `brief` was the dangerous one: estimated at 380s against a
// real 719s max, so the guard would happily start a brief with ~400s left and overrun.
// Re-derive with that query rather than nudging these by feel.
const PIPELINE_TIME_ESTIMATE_MS: Record<string, number> = {
  brief: 780_000,
  content: 480_000,
  visibility: 440_000,
  events: 430_000,
  // starter: NOT observed yet (new in 3.1) — derived from the abort ceilings instead, which is the
  // right posture for this decision: PRODUCER_TIMEOUT_MS (300s) is the hard bound on its one model
  // call, plus headroom for the dossier build's vendor pulls. RECALIBRATE from real
  // claimed_at -> updated_at once first-run data exists; do not nudge by feel.
  starter: 400_000,
  busy_times: 390_000,
  insights: 350_000,
  social: 310_000,
  weather: 240_000,
  photos: 220_000,
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

// ── First-run insights readiness gate (beta rescue 3.1) ──────────────────────
// Replaces the hardcoded 15-minute enqueue delay (see enqueueFirstRun). The insights pipeline
// reads what the data pulls WRITE, so what it actually needs is "the data pulls are done", not
// "15 minutes have passed". The bound exists for the same reason the brief's does: a permanently
// stuck data pull must never starve the first brief. 20 minutes is deliberately just past the old
// timer, so the worst case is no worse than the behaviour this replaces, while the common case
// fires as soon as the pulls land.
export const FIRST_RUN_INSIGHTS_MAX_WAIT_MS = 20 * 60 * 1000

/**
 * Should a claimed FIRST-RUN insights job DEFER to wait for its location's data pulls? Pure.
 * `pending` counts only the first-run DATA pipelines — never the insights job itself (it is
 * 'running' at this point and would otherwise wait on itself forever) and never `starter`
 * (the starter reads the dossier, writes no snapshot insights depends on).
 */
export function firstRunInsightsShouldWait(args: { pending: number; jobAgeMs: number }): boolean {
  return args.pending > 0 && args.jobAgeMs < FIRST_RUN_INSIGHTS_MAX_WAIT_MS
}

/** How many of `pipelines` are still queued or running for this location. Returns 0 on a read
 *  error, i.e. FAILS OPEN (don't wait) — the same posture as locationHasPendingDataJobs, for the
 *  same reason: a transient SELECT failure must not stall the pipeline it is meant to protect. */
export async function countPendingPipelines(sb: SB, locationId: string, pipelines: readonly string[]): Promise<number> {
  const { count, error } = await sb
    .from("signal_jobs")
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId)
    .in("pipeline", pipelines as unknown as string[])
    .in("status", ["queued", "running"])
  if (error) {
    console.warn(`[queue] pending-pipelines check failed for ${locationId}; not waiting:`, error.message)
    return 0
  }
  return count ?? 0
}

/**
 * The ONE data-readiness gate every worker entry point consults for a claimed job, so the cron
 * worker and the scoped first-run drain cannot drift apart.
 *
 *  - scheduled `brief`      waits for its location's data jobs to settle (ENG-H3, unchanged).
 *  - first-run `insights`   waits for its location's first-run DATA pulls to settle (3.1).
 *  - first-run `brief`      does NOT wait: it is chained straight after its insights job, which
 *                           has already waited, and it is meant to appear immediately (unchanged).
 *  - everything else        never waits.
 */
export async function claimedJobShouldWait(sb: SB, job: SignalJob): Promise<boolean> {
  const scopeMode = (job.cursor as { mode?: string } | null)?.mode
  const ageMs = Date.now() - new Date(job.created_at).getTime()
  if (job.pipeline === "brief" && scopeMode !== "first_run") {
    const pending = await locationHasPendingDataJobs(sb, job.location_id)
    return briefShouldWaitForData({ pending, briefAgeMs: ageMs })
  }
  if (job.pipeline === "insights" && scopeMode === "first_run") {
    const pending = await countPendingPipelines(sb, job.location_id, FIRST_RUN_DATA)
    return firstRunInsightsShouldWait({ pending, jobAgeMs: ageMs })
  }
  return false
}

// ── Scoped first-run claim (beta rescue 3.1) ─────────────────────────────────
// claim_signal_jobs is fleet-wide and orders by created_at, which is right for the nightly drain
// and wrong for a brand-new signup: at 06:00 the daily cron enqueues the whole fleet, so a 07:00
// signup's jobs sit BEHIND every one of them and the operator waits hours. The first-run drain
// route claims this ONE location's first-run jobs directly instead of waiting its turn.
//
// Concurrency-safety comes from the status predicate, not from a lock: two concurrent drains both
// issue `update ... where id = $1 and status = 'queued'`, Postgres serialises them on the row, and
// the loser re-evaluates the predicate against the winner's committed row version and matches
// nothing. Same contract as claim_signal_jobs, scoped to one row.

/** This location's due first-run jobs, oldest first (the enqueue order: starter, data, insights). */
export async function dueFirstRunJobs(sb: SB, locationId: string): Promise<SignalJob[]> {
  const { data, error } = await sb
    .from("signal_jobs")
    .select("*")
    .eq("location_id", locationId)
    .eq("status", "queued")
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(20)
  if (error) throw error
  return ((data ?? []) as SignalJob[]).filter(
    (j) => (j.cursor as { mode?: string } | null)?.mode === "first_run",
  )
}

/** Atomically claim ONE queued job by id. Returns the claimed row, or null if someone else won. */
export async function claimJobById(sb: SB, jobId: string): Promise<SignalJob | null> {
  const now = new Date().toISOString()
  const { data, error } = await sb
    .from("signal_jobs")
    .update({ status: "running", claimed_at: now, updated_at: now })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
  if (error) throw error
  const rows = (data ?? []) as SignalJob[]
  if (rows.length === 0) return null
  // claim_signal_jobs increments attempts as part of the claim; mirror that here so a job claimed
  // through this path is subject to the SAME max_attempts ceiling and cannot retry forever.
  const claimed = { ...rows[0], attempts: rows[0].attempts + 1 }
  await sb.from("signal_jobs").update({ attempts: claimed.attempts }).eq("id", jobId)
  return claimed
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
