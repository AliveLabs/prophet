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
import { claimJobs } from "@/lib/jobs/queue"
import { runJob } from "@/lib/jobs/worker"

export const maxDuration = 300

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
    const results = []
    for (const job of jobs) {
      results.push(await runJob(sb, job))
    }
    console.log(`[worker] claimed=${jobs.length}`, results.map((r) => `${r.pipeline}:${r.outcome}/${r.disposition}`).join(" "))
    return Response.json({ ok: true, claimed: jobs.length, results })
  } catch (err) {
    console.error("[worker] fatal:", err)
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
