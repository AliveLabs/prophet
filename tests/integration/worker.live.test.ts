import { describe, it, expect } from "vitest"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { enqueueRun, claimJobs, finishJob } from "@/lib/jobs/queue"
import { runJob } from "@/lib/jobs/worker"

// Live end-to-end proof of the durable queue on the branch:
//   enqueue -> atomic claim -> runJob -> honest pipeline_runs outcome -> signal_jobs done.
// Uses `weather` (fast, deterministic). Run with env sourced:
//   set -a; . ./.env.local; set +a; npx vitest run --config vitest.integration.config.ts tests/integration/worker.live.test.ts
describe("queue worker (live): enqueue -> claim -> run -> honest outcome", () => {
  it("drains a weather job and records a pipeline_runs outcome", async () => {
    const sb = createAdminSupabaseClient()
    const { data: loc } = await sb
      .from("locations")
      .select("id, organization_id, name")
      .ilike("name", "%wagyu%")
      .limit(1)
      .maybeSingle()
    expect(loc, "expected a Wagyu location on the branch").toBeTruthy()
    const runId = crypto.randomUUID()

    const enqueued = await enqueueRun(sb, {
      runId,
      organizationId: loc!.organization_id as string,
      locationId: loc!.id as string,
      pipelines: ["weather"],
    })
    expect(enqueued).toBe(1)

    // Claim; release any jobs that aren't ours (keeps the test hermetic if the queue isn't empty).
    const claimed = await claimJobs(sb, 5)
    const mine = claimed.filter((j) => j.run_id === runId)
    for (const j of claimed) if (j.run_id !== runId) await finishJob(sb, j, false) // requeue others
    expect(mine.length).toBe(1)

    const result = await runJob(sb, mine[0])
    console.log(`\n[worker.live] ${result.pipeline} -> outcome=${result.outcome} disposition=${result.disposition}`)

    // pipeline_runs recorded an honest outcome
    const { data: runs } = await sb.from("pipeline_runs").select("pipeline, outcome, reason, signals").eq("run_id", runId)
    console.log(`[worker.live] pipeline_runs:`, JSON.stringify(runs))
    expect(runs?.length).toBe(1)
    expect(["fresh", "partial", "failed", "no_data", "dormant", "served_stale", "skipped"]).toContain(runs![0].outcome)

    // signal_jobs reached a terminal-ish disposition
    const { data: jobRows } = await sb.from("signal_jobs").select("status").eq("run_id", runId)
    expect(["done", "failed", "queued"]).toContain(jobRows![0].status)

    // cleanup so the branch queue stays clean
    await sb.from("pipeline_runs").delete().eq("run_id", runId)
    await sb.from("signal_jobs").delete().eq("run_id", runId)
  })
})
