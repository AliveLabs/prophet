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

export async function enqueueRun(
  sb: SB,
  args: {
    runId: string
    organizationId: string
    locationId: string
    pipelines: readonly string[]
    /** Optional delay (e.g. enqueue `insights` after the data pipelines have a head start). */
    delaySeconds?: number
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
  }))
  const { error } = await sb.from("signal_jobs").insert(rows)
  if (error) throw error
  return rows.length
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
