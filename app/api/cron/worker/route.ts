// ---------------------------------------------------------------------------
// GET /api/cron/worker — drains the signal_jobs queue (Spine rewrite · Phase 3)
//
// Claims a small batch of due jobs (atomic, concurrency-safe) and runs ONE
// pipeline each, recording honest pipeline_runs outcomes. Runs frequently (see
// vercel.json) so the queue drains without any single invocation needing to
// finish everything. Auth: CRON_SECRET (same as the daily cron).
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import { claimJobs, deferJob, shouldDeferJob } from "@/lib/jobs/queue"
import { runJob, type WorkerJobResult } from "@/lib/jobs/worker"

// 800 (Fluid Compute): the `brief` job runs the multi-skill LLM synthesis,
// which can exceed 300s for a signal-rich location — same budget as the
// build-brief cron. Zombie reclaim below stays at 20 min (> 800s), consistent.
export const maxDuration = 800

function admin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } }
  )
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  // Small batch so each job gets a real slice of the 300s budget. The slowest
  // pipelines self-chunk via the job cursor (Phase 3b); for now 1–2 per invocation.
  const batch = Math.min(Math.max(Number(url.searchParams.get("batch") ?? 2) || 2, 1), 4)

  try {
    const sb = admin()
    // Reclaim zombies: a worker invocation that died mid-job (timeout/crash) leaves the
    // row 'running' forever — observed in prod (16 stuck). Stale running → back to queued
    // (idempotent pipelines; attempts already counted by the claim).
    await sb
      .from("signal_jobs")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("status", "running")
      .lt("claimed_at", new Date(Date.now() - 20 * 60 * 1000).toISOString())
    const jobs = await claimJobs(sb, batch)
    const results: WorkerJobResult[] = []
    // Budget-aware: don't START a job that can't finish in the remaining 800s
    // (would zombie-out → reclaim → staleQueued → watchdog). Deferred jobs are
    // requeued due-now (no attempt burned) for the next tick's fresh budget. A
    // cheaper later job in the batch can still run, so evaluate each (no break).
    const startMs = Date.now()
    let executed = 0
    for (const job of jobs) {
      if (shouldDeferJob({ pipeline: job.pipeline, elapsedMs: Date.now() - startMs, executed })) {
        // Don't let one defer write failure abort the whole batch — on error the row simply
        // stays 'running' and the zombie-reclaim above catches it next tick (self-healing).
        try {
          await deferJob(sb, job)
          results.push({ jobId: job.id, pipeline: job.pipeline, outcome: "skipped", disposition: "deferred" })
        } catch (e) {
          console.warn(`[worker] deferJob failed for ${job.id} (${job.pipeline}):`, e)
        }
        continue
      }
      results.push(await runJob(sb, job))
      executed++
    }
    console.log(`[worker] claimed=${jobs.length}`, results.map((r) => `${r.pipeline}:${r.outcome}/${r.disposition}`).join(" "))
    return Response.json({ ok: true, claimed: jobs.length, results })
  } catch (err) {
    console.error("[worker] fatal:", err)
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
