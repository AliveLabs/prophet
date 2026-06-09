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
