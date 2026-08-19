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

  it("the brief estimate is far more pessimistic than any observed first-run brief", () => {
    // Observed first-run brief durations from pipeline_runs: 186, 189, 192, 214, 217 seconds.
    // The estimate is 780s. Recalibrating it is a SPEND decision (starting a brief with too little
    // budget risks a mid-flight kill and a retry, which doubles the model cost), so it is filed
    // rather than changed here. This test exists to make the gap visible, not to justify a nudge.
    const observedMaxMs = 217_000
    expect(estimatePipelineMs("brief")).toBeGreaterThan(observedMaxMs * 3)
  })
})
