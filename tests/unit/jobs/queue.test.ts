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
  it("returns conservative (above-average) estimates per pipeline", () => {
    expect(estimatePipelineMs("content")).toBe(450_000) // avg observed ~334s
    expect(estimatePipelineMs("brief")).toBe(380_000) // avg observed ~271s
    expect(estimatePipelineMs("weather")).toBe(90_000)
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
    // remaining = 800k - 400k - 90k = 310k < content estimate 450k → defer
    expect(shouldDeferJob({ pipeline: "content", elapsedMs: 400_000, executed: 1 })).toBe(true)
  })

  it("still runs a cheap 2nd job even when a slow one wouldn't fit", () => {
    // same 310k remaining, but weather (90k) fits → don't defer
    expect(shouldDeferJob({ pipeline: "weather", elapsedMs: 400_000, executed: 1 })).toBe(false)
  })

  it("respects the safety margin at the boundary", () => {
    // remaining must clear estimate + margin. Pick elapsed so remaining == estimate exactly → runs.
    const elapsedExact = WORKER_BUDGET_MS - WORKER_SAFETY_MARGIN_MS - estimatePipelineMs("brief")
    expect(shouldDeferJob({ pipeline: "brief", elapsedMs: elapsedExact, executed: 1 })).toBe(false)
    expect(shouldDeferJob({ pipeline: "brief", elapsedMs: elapsedExact + 1, executed: 1 })).toBe(true)
  })
})
