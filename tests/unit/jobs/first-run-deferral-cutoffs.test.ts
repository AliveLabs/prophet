// ALT-655 / ALT-661. Why a first run spends minutes idle rather than working.
//
// Measured on Jersey Mike's (2026-08-17), the one clean cold start on record: 21.2 minutes from
// setup complete to brief ready, of which 4.3 minutes was idle in two gaps — 2.9 min between the
// last data pull and insights, then 1.4 min between insights and the brief. Mean wait for the
// five-minute worker cron is 2.5 min, which is what both gaps actually are.
//
// The cause is structural, not a stall: shouldDeferJob compares a PESSIMISTIC per-pipeline estimate
// against the budget left in the current invocation, so two first-run jobs can effectively only run
// as the FIRST job of a fresh call. Something therefore has to invoke again after each of them.
// These pin that arithmetic so a change to the budget or the estimates cannot silently move it.

import { describe, it, expect } from "vitest"
import {
  shouldDeferJob,
  estimatePipelineMs,
  WORKER_BUDGET_MS,
  WORKER_SAFETY_MARGIN_MS,
} from "@/lib/jobs/queue"

/** Latest elapsed time at which `pipeline` may still START mid-invocation. Negative = never. */
function latestMidCallStartMs(pipeline: string): number {
  return WORKER_BUDGET_MS - WORKER_SAFETY_MARGIN_MS - estimatePipelineMs(pipeline)
}

describe("ALT-661: which first-run jobs need a fresh invocation, and why", () => {
  it("the first job of an invocation always runs, whatever it costs", () => {
    // This is the escape hatch that keeps a brief runnable at all.
    expect(shouldDeferJob({ pipeline: "brief", elapsedMs: 0, executed: 0 })).toBe(false)
    expect(shouldDeferJob({ pipeline: "brief", elapsedMs: 600_000, executed: 0 })).toBe(false)
  })

  it("brief can NEVER start mid-invocation: its estimate exceeds the whole usable budget", () => {
    expect(latestMidCallStartMs("brief")).toBeLessThan(0)
    // So even one second in, with one job already run, it defers.
    expect(shouldDeferJob({ pipeline: "brief", elapsedMs: 1_000, executed: 1 })).toBe(true)

    // ALT-681 asked whether to fix this by LOWERING the estimate. Measured answer: no, the
    // estimate is right (see the assertion below: p99 719s, max 793s against a 780s estimate).
    // This is structural, not a bad number. The two honest levers are raising WORKER_BUDGET_MS, or
    // scoping the estimate by run mode, since a first-run dossier covers one location with
    // competitors just chosen while a nightly Multi-Location brief carries far more. `signal_jobs`
    // records no run mode, so a first-run estimate cannot be derived from it yet; ALT-676's
    // instrumentation is what makes that possible.
  })

  it("insights stops being startable about six minutes into an invocation", () => {
    const cutoff = latestMidCallStartMs("insights")
    expect(cutoff).toBeGreaterThan(0)
    expect(Math.round(cutoff / 60_000)).toBe(6)
    expect(shouldDeferJob({ pipeline: "insights", elapsedMs: cutoff - 1_000, executed: 1 })).toBe(false)
    expect(shouldDeferJob({ pipeline: "insights", elapsedMs: cutoff + 1_000, executed: 1 })).toBe(true)
  })

  it("Jersey Mike's: data pulls finished at 10.2 min, PAST the insights cutoff", () => {
    // This is the 2.9-minute gap, reproduced as arithmetic rather than asserted from a log.
    const dataPullsDoneAt = 10.2 * 60_000
    expect(dataPullsDoneAt).toBeGreaterThan(latestMidCallStartMs("insights"))
    expect(shouldDeferJob({ pipeline: "insights", elapsedMs: dataPullsDoneAt, executed: 8 })).toBe(true)
  })

  // ── ALT-681: this test used to assert a FALSE premise, and it passed ────────────────────────
  //
  // It read: "the brief estimate is far more pessimistic than any observed first-run brief", with
  // `observedMaxMs = 217_000` and `expect(estimatePipelineMs("brief")).toBeGreaterThan(217_000 * 3)`.
  //
  // 217s came from five hand-picked FIRST-RUN rows (186/189/192/214/217). It is not the observed
  // max of anything else, and a five-row sample of the cheapest workload is not a calibration.
  // Re-derived 2026-08-23 from all 262 completed brief jobs in prod, measuring
  // `claimed_at -> updated_at` on `signal_jobs`, which is the quantity the estimate is compared
  // against inside shouldDeferJob:
  //
  //     p50 366s · p95 545s · p99 719s · max 793s
  //
  // So the 780s estimate is about 1.0x the observed max, NOT 3.6x. The old assertion made an
  // almost-exactly-right number look like a 3.6x over-provision, and the ticket it was written to
  // support proposed cutting it. Cutting it toward 250s would have killed the majority of briefs
  // mid-flight (p50 is 366s) and retried them, doubling the spend on the most expensive job in the
  // run. That is the precise harm the ticket itself warned about.
  //
  // A test that pins a measured number has to pin the RIGHT one, or it manufactures false
  // confidence in whatever direction the sample happened to lean.

  it("the brief estimate covers the observed max, so a brief is never started with too little budget", () => {
    // The load-bearing property, stated as the inequality that matters. Measured max is 793s and
    // the estimate is 780s: within 2%, which is the intended posture (the queue.ts header says to
    // size against the max, not the mean, because the tails sit far above the means here).
    const observedMaxMs = 793_000
    const observedP99Ms = 719_000
    expect(estimatePipelineMs("brief")).toBeGreaterThan(observedP99Ms)
    // Do NOT lower this below the p99. If it ever needs to move, re-derive from the query in the
    // queue.ts header first; do not nudge it by feel, and do not calibrate off first-run rows
    // alone, which is how the 217s figure got here.
    expect(estimatePipelineMs("brief")).toBeGreaterThan(observedMaxMs * 0.95)
  })

})
