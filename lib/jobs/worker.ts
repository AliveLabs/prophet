// ---------------------------------------------------------------------------
// Queue worker (Spine rewrite · Phase 3)
//
// Runs ONE pipeline per claimed job (so nothing must finish all 8 in one 300s
// invocation), records an honest pipeline_runs outcome + reason, and retries
// transient failures via finishJob's backoff. Reuses the same SUB_PIPELINES the
// legacy inline refresh_all used.
// ---------------------------------------------------------------------------

import { SUB_PIPELINES, type SubPipeline } from "@/lib/jobs/pipelines/refresh-all"
import { finishJob, recordRun, type SB, type SignalJob, type PipelineOutcome } from "./queue"
import { socialContentAsOf } from "@/lib/freshness/extract"
import { classifyNow, type FreshnessStatus } from "@/lib/freshness/contract"

// Gemini-Vision step is too slow for the scheduled path (sequential, ~60s/profile →
// the original 300s timeout). Run it out-of-band; the metric + insight steps still run.
const SKIP_STEPS = new Set(["analyze_social_visuals"])

const PIPELINE_BY_NAME = new Map<string, SubPipeline>(SUB_PIPELINES.map((s) => [s.name, s]))

export type WorkerJobResult = {
  jobId: string
  pipeline: string
  outcome: PipelineOutcome
  disposition: "done" | "failed" | "requeued"
}

export async function runJob(sb: SB, job: SignalJob): Promise<WorkerJobResult> {
  const startedAt = new Date().toISOString()
  const sub = PIPELINE_BY_NAME.get(job.pipeline)

  if (!sub) {
    await recordRun(sb, { runId: job.run_id, locationId: job.location_id, pipeline: job.pipeline, outcome: "skipped", reason: `unknown pipeline '${job.pipeline}'`, startedAt })
    await finishJob(sb, job, true)
    return { jobId: job.id, pipeline: job.pipeline, outcome: "skipped", disposition: "done" }
  }

  try {
    const ctx = await sub.buildCtx(sb, job.location_id, job.organization_id)
    const steps = (sub.ctxArg ? sub.buildSteps(ctx) : sub.buildSteps()).filter((s) => !SKIP_STEPS.has(s.name))

    let completed = 0
    let failed = 0
    const warnings: string[] = []
    for (const step of steps) {
      try {
        await step.run(ctx)
        completed++
      } catch (e) {
        failed++
        warnings.push(`${step.label}: ${e instanceof Error ? e.message : "failed"}`)
      }
    }

    const { outcome, reason, signals } = await summarize(sb, job, { completed, failed, warnings })
    await recordRun(sb, { runId: job.run_id, locationId: job.location_id, pipeline: job.pipeline, outcome, reason, signals, startedAt })

    // Fully-failed → retry; any progress → done (partial is recorded honestly, not retried forever).
    const ok = completed > 0 || failed === 0
    const disposition = await finishJob(sb, job, ok, warnings.join(" | ") || undefined)
    return { jobId: job.id, pipeline: job.pipeline, outcome, disposition }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "context build failed"
    await recordRun(sb, { runId: job.run_id, locationId: job.location_id, pipeline: job.pipeline, outcome: "failed", reason: msg, startedAt })
    const disposition = await finishJob(sb, job, false, msg)
    return { jobId: job.id, pipeline: job.pipeline, outcome: "failed", disposition }
  }
}

async function summarize(
  sb: SB,
  job: SignalJob,
  r: { completed: number; failed: number; warnings: string[] }
): Promise<{ outcome: PipelineOutcome; reason?: string; signals: Record<string, unknown> }> {
  if (r.completed === 0 && r.failed > 0) {
    return { outcome: "failed", reason: r.warnings[0], signals: { completed: r.completed, failed: r.failed } }
  }

  // Social: outcome reflects real content freshness, not just "the call returned".
  if (job.pipeline === "social") {
    const counts = await socialFreshnessForLocation(sb, job.location_id)
    const usable = counts.fresh + counts.aging
    const stale = counts.dormant + counts.empty + counts.undated
    const outcome: PipelineOutcome =
      r.failed > 0 ? "partial" : usable > 0 ? "fresh" : stale > 0 ? "dormant" : "no_data"
    const reason =
      usable > 0
        ? `${usable} active account${usable === 1 ? "" : "s"}`
        : stale > 0
          ? `${counts.dormant} dormant / ${counts.empty} empty — no recent activity`
          : "no social profiles"
    return { outcome, reason, signals: { ...counts, completed: r.completed, failed: r.failed } }
  }

  const outcome: PipelineOutcome = r.failed > 0 ? "partial" : "fresh"
  return {
    outcome,
    reason: r.failed > 0 ? r.warnings.slice(0, 2).join(" | ") : undefined,
    signals: { completed: r.completed, failed: r.failed },
  }
}

/** Tally the latest social snapshot freshness across a location's own + competitor entities. */
async function socialFreshnessForLocation(sb: SB, locationId: string): Promise<Record<FreshnessStatus, number>> {
  const counts: Record<FreshnessStatus, number> = { fresh: 0, aging: 0, dormant: 0, empty: 0, undated: 0 }
  const { data: comps } = await sb.from("competitors").select("id").eq("location_id", locationId)
  const entityIds = [locationId, ...(comps ?? []).map((c) => c.id as string)]
  const { data: profiles } = await sb.from("social_profiles").select("id").in("entity_id", entityIds)
  const profIds = (profiles ?? []).map((p) => p.id as string)
  if (profIds.length === 0) return counts

  const { data: snaps } = await sb
    .from("social_snapshots")
    .select("social_profile_id, raw_data, captured_at, date_key")
    .in("social_profile_id", profIds)
    .order("date_key", { ascending: false })

  const seen = new Set<string>()
  for (const s of snaps ?? []) {
    const pid = s.social_profile_id as string
    if (seen.has(pid)) continue
    seen.add(pid)
    const probe = socialContentAsOf(s.raw_data as Record<string, unknown>)
    const status = classifyNow({
      contentAsOf: probe.contentAsOf,
      capturedAt: (s.captured_at as string) ?? (s.date_key as string),
      isEmpty: probe.isEmpty,
      kind: "social",
    })
    counts[status] += 1
  }
  return counts
}
