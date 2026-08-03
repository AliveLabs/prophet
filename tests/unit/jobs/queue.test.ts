import { describe, it, expect } from "vitest"
import {
  backoffSeconds,
  DAILY_PIPELINES,
  estimatePipelineMs,
  shouldDeferJob,
  WORKER_BUDGET_MS,
  WORKER_SAFETY_MARGIN_MS,
} from "@/lib/jobs/queue"

describe("backoffSeconds", () => {
  it("grows exponentially from 60s and caps at 1h", () => {
    expect(backoffSeconds(1)).toBe(60)
    expect(backoffSeconds(2)).toBe(120)
    expect(backoffSeconds(3)).toBe(240)
    expect(backoffSeconds(4)).toBe(480)
    expect(backoffSeconds(20)).toBe(3600) // capped
    expect(backoffSeconds(0)).toBe(60) // floor
  })
})

describe("DAILY_PIPELINES", () => {
  it("includes social and runs insights last (depends on the rest)", () => {
    expect(DAILY_PIPELINES).toContain("social")
    expect(DAILY_PIPELINES[DAILY_PIPELINES.length - 1]).toBe("insights")
  })
})

describe("estimatePipelineMs", () => {
  it("bounds the observed TAIL, not the average (recalibrated 2026-08-03)", () => {
    // These exist so shouldDeferJob can answer "will this finish in my remaining budget?", so each
    // must sit above the observed max — an estimate under the tail lets a job overrun maxDuration
    // and zombie. Observed max: brief 719s, content 425s, weather 196s.
    expect(estimatePipelineMs("brief")).toBeGreaterThan(719_000)
    expect(estimatePipelineMs("content")).toBeGreaterThan(425_000)
    expect(estimatePipelineMs("weather")).toBeGreaterThan(196_000)
  })
  it("keeps brief as the longest pole (it was under-estimated at 380s against a 719s real max)", () => {
    const brief = estimatePipelineMs("brief")
    for (const p of ["content", "visibility", "insights", "photos", "events", "social", "busy_times", "weather"]) {
      expect(brief).toBeGreaterThan(estimatePipelineMs(p))
    }
  })
  it("falls back to a default for unknown pipelines", () => {
    expect(estimatePipelineMs("some_new_pipeline")).toBe(320_000)
  })
})

describe("shouldDeferJob", () => {
  it("never defers the first job of an invocation (forward progress)", () => {
    // executed === 0: even a near-exhausted budget must still run one job.
    expect(shouldDeferJob({ pipeline: "content", elapsedMs: 700_000, executed: 0 })).toBe(false)
  })

  it("runs a 2nd job when ample budget remains", () => {
    expect(shouldDeferJob({ pipeline: "content", elapsedMs: 100_000, executed: 1 })).toBe(false)
  })

  it("defers a slow 2nd job that can't finish in the remaining budget", () => {
    // remaining = 800k - 400k - 90k = 310k < content estimate 480k → defer
    expect(shouldDeferJob({ pipeline: "content", elapsedMs: 400_000, executed: 1 })).toBe(true)
  })

  it("still runs a cheap 2nd job even when a slow one wouldn't fit", () => {
    // same 310k remaining, but weather (240k) fits → don't defer
    expect(shouldDeferJob({ pipeline: "weather", elapsedMs: 400_000, executed: 1 })).toBe(false)
  })

  it("never starts a brief that would overrun the invocation", () => {
    // The regression the recalibration fixes: at the old 380s estimate a brief could start with
    // ~400s left and run its real 719s tail, overrunning maxDuration into a 20-min zombie reclaim.
    expect(shouldDeferJob({ pipeline: "brief", elapsedMs: 300_000, executed: 1 })).toBe(true)
  })

  it("lets a whole batch of cheap jobs through on a fresh budget (the throughput case)", () => {
    // batch is 4 now; four cheap pipelines back-to-back must all clear the guard, or raising the
    // batch buys nothing.
    let elapsed = 0
    for (const [pipeline, realMs] of [["weather", 50_000], ["social", 79_000], ["events", 79_000], ["photos", 85_000]] as const) {
      expect(shouldDeferJob({ pipeline, elapsedMs: elapsed, executed: 1 })).toBe(false)
      elapsed += realMs
    }
  })

  it("respects the safety margin at the boundary", () => {
    // remaining must clear estimate + margin. Pick elapsed so remaining == estimate exactly → runs.
    const elapsedExact = WORKER_BUDGET_MS - WORKER_SAFETY_MARGIN_MS - estimatePipelineMs("brief")
    expect(shouldDeferJob({ pipeline: "brief", elapsedMs: elapsedExact, executed: 1 })).toBe(false)
    expect(shouldDeferJob({ pipeline: "brief", elapsedMs: elapsedExact + 1, executed: 1 })).toBe(true)
  })
})
