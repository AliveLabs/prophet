// ---------------------------------------------------------------------------
// Queue worker (Spine rewrite · Phase 3)
//
// Runs ONE pipeline per claimed job (so nothing must finish all 8 in one 300s
// invocation), records an honest pipeline_runs outcome + reason, and retries
// transient failures via finishJob's backoff. Reuses the same SUB_PIPELINES the
// legacy inline refresh_all used.
// ---------------------------------------------------------------------------

import { SUB_PIPELINES, type SubPipeline } from "@/lib/jobs/pipelines/refresh-all"
import { enqueueRun, finishJob, recordRun, type SB, type SignalJob, type PipelineOutcome } from "./queue"
import { socialContentAsOf } from "@/lib/freshness/extract"
import { classifyNow, type FreshnessStatus } from "@/lib/freshness/contract"
import { vendorSignalFromError, moreSevereVendorSignal, type VendorSignal } from "@/lib/jobs/vendor-health"

// Steps excluded from the scheduled path. analyze_social_visuals used to live here
// (it was unbounded); it now self-caps at MAX_VISION_POSTS_PER_RUN per run (photos
// pattern), so it runs scheduled again. Kept as a mechanism for future escapes.
const SKIP_STEPS = new Set<string>([])

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

    // Apply the job's pull scope (cadence mode / forced refresh / platform filter) so the
    // social pipeline can skip in-cadence pulls (Data365 billing) and honor "refresh just X".
    const scope = (job.cursor ?? {}) as { mode?: string; force?: boolean; platforms?: string[] }
    if (job.pipeline === "social") {
      const sctx = ctx as { mode?: string; force?: boolean; platforms?: string[] }
      sctx.mode = scope.mode ?? "daily"
      sctx.force = scope.force ?? false
      if (Array.isArray(scope.platforms) && scope.platforms.length > 0) sctx.platforms = scope.platforms
    }

    const steps = (sub.ctxArg ? sub.buildSteps(ctx) : sub.buildSteps()).filter((s) => !SKIP_STEPS.has(s.name))

    let completed = 0
    let failed = 0
    const warnings: string[] = []
    // Capture a vendor outage (e.g. DataForSEO 402) so it's recorded as a structured signal,
    // not just laundered into a generic "partial"/"failed" reason string. Keep the worst one.
    let vendorError: VendorSignal | undefined
    for (const step of steps) {
      try {
        await step.run(ctx)
        completed++
      } catch (e) {
        failed++
        warnings.push(`${step.label}: ${e instanceof Error ? e.message : "failed"}`)
        vendorError = moreSevereVendorSignal(vendorError, vendorSignalFromError(e))
      }
    }

    const { outcome, reason, signals } = await summarize(sb, job, { completed, failed, warnings, vendorError })
    await recordRun(sb, { runId: job.run_id, locationId: job.location_id, pipeline: job.pipeline, outcome, reason, signals, startedAt })

    // Fully-failed → retry; any progress → done (partial is recorded honestly, not retried forever).
    const ok = completed > 0 || failed === 0
    const disposition = await finishJob(sb, job, ok, warnings.join(" | ") || undefined)

    // A finished first_run insights job chains the brief build (same run_id, so
    // the onboarding tracker shows it) — a new signup's first brief must not
    // wait for the next 8:00 UTC build-brief cron.
    if (job.pipeline === "insights" && scope.mode === "first_run" && disposition === "done") {
      await enqueueFirstBrief(sb, job)
    }

    return { jobId: job.id, pipeline: job.pipeline, outcome, disposition }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "context build failed"
    const vendorError = vendorSignalFromError(e)
    await recordRun(sb, {
      runId: job.run_id,
      locationId: job.location_id,
      pipeline: job.pipeline,
      outcome: "failed",
      reason: msg,
      signals: vendorError ? { vendor: vendorError } : undefined,
      startedAt,
    })
    const disposition = await finishJob(sb, job, false, msg)
    return { jobId: job.id, pipeline: job.pipeline, outcome: "failed", disposition }
  }
}

/** Chain the brief build after a first_run insights job (idempotent per run). */
async function enqueueFirstBrief(sb: SB, job: SignalJob): Promise<void> {
  try {
    const { data: existing } = await sb
      .from("signal_jobs")
      .select("id")
      .eq("run_id", job.run_id)
      .eq("pipeline", "brief")
      .limit(1)
      .maybeSingle()
    if (existing) return

    await enqueueRun(sb, {
      runId: job.run_id,
      organizationId: job.organization_id,
      locationId: job.location_id,
      pipelines: ["brief"],
      scope: { mode: "first_run" },
    })
  } catch (e) {
    // Non-fatal: the 8:00 UTC build-brief cron still covers the location.
    console.warn(`[worker] enqueueFirstBrief failed for ${job.location_id}:`, e)
  }
}

async function summarize(
  sb: SB,
  job: SignalJob,
  r: { completed: number; failed: number; warnings: string[]; vendorError?: VendorSignal }
): Promise<{ outcome: PipelineOutcome; reason?: string; signals: Record<string, unknown> }> {
  // A vendor outage rides along on every outcome so the UI/detector can read the CAUSE,
  // not just infer it from a failed count. (Stamped on signals.vendor; no schema change.)
  const vendor = r.vendorError ? { vendor: r.vendorError } : {}

  if (r.completed === 0 && r.failed > 0) {
    return { outcome: "failed", reason: r.warnings[0], signals: { completed: r.completed, failed: r.failed, ...vendor } }
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
    return { outcome, reason, signals: { ...counts, completed: r.completed, failed: r.failed, ...vendor } }
  }

  const outcome: PipelineOutcome = r.failed > 0 ? "partial" : "fresh"
  return {
    outcome,
    reason: r.failed > 0 ? r.warnings.slice(0, 2).join(" | ") : undefined,
    signals: { completed: r.completed, failed: r.failed, ...vendor },
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
