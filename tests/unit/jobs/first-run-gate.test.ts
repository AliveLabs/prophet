import { describe, it, expect } from "vitest"
import {
  BRIEF_MAX_DATA_WAIT_MS,
  FIRST_RUN_DATA,
  FIRST_RUN_INSIGHTS_MAX_WAIT_MS,
  FIRST_RUN_STARTER,
  estimatePipelineMs,
  firstRunInsightsShouldWait,
} from "@/lib/jobs/queue"
import { FIRST_RUN_DRAIN_CONCURRENCY } from "@/lib/jobs/first-run-drain"

describe("firstRunInsightsShouldWait (replaces the hardcoded 15-minute enqueue delay)", () => {
  it("waits while any first-run data pull is still queued or running", () => {
    expect(firstRunInsightsShouldWait({ pending: 1, jobAgeMs: 0 })).toBe(true)
    expect(firstRunInsightsShouldWait({ pending: 7, jobAgeMs: 60_000 })).toBe(true)
  })

  it("fires the MOMENT the data pulls settle — no floor, which is the whole point", () => {
    // The old timer made every location wait 15 minutes even when its pulls finished in four.
    expect(firstRunInsightsShouldWait({ pending: 0, jobAgeMs: 0 })).toBe(false)
    expect(firstRunInsightsShouldWait({ pending: 0, jobAgeMs: 4 * 60_000 })).toBe(false)
  })

  it("is BOUNDED, so a wedged data pull can never starve the first brief", () => {
    expect(firstRunInsightsShouldWait({ pending: 3, jobAgeMs: FIRST_RUN_INSIGHTS_MAX_WAIT_MS - 1 })).toBe(true)
    expect(firstRunInsightsShouldWait({ pending: 3, jobAgeMs: FIRST_RUN_INSIGHTS_MAX_WAIT_MS })).toBe(false)
    expect(firstRunInsightsShouldWait({ pending: 3, jobAgeMs: 10 * FIRST_RUN_INSIGHTS_MAX_WAIT_MS })).toBe(false)
  })

  it("treats a failed read as 'do not wait' (countPendingPipelines fails open with 0)", () => {
    expect(firstRunInsightsShouldWait({ pending: 0, jobAgeMs: 1 })).toBe(false)
  })

  it("bounds the wait no worse than the 15-minute timer it replaced", () => {
    expect(FIRST_RUN_INSIGHTS_MAX_WAIT_MS).toBeGreaterThanOrEqual(15 * 60 * 1000)
    // and stays well under the brief's own data-wait bound, so the two gates cannot compound
    // into a wait longer than the brief already tolerates.
    expect(FIRST_RUN_INSIGHTS_MAX_WAIT_MS).toBeLessThan(BRIEF_MAX_DATA_WAIT_MS)
  })
})

describe("FIRST_RUN_DATA (what the insights readiness gate counts)", () => {
  it("is the data pulls only: never insights itself (it would wait on itself forever)", () => {
    expect(FIRST_RUN_DATA).not.toContain("insights")
  })
  it("never includes the starter or the brief — neither writes what insights reads", () => {
    expect(FIRST_RUN_DATA).not.toContain(FIRST_RUN_STARTER)
    expect(FIRST_RUN_DATA).not.toContain("brief")
  })
  it("covers every pull the insights pipeline reads the output of", () => {
    for (const pipeline of ["content", "visibility", "events"]) {
      expect(FIRST_RUN_DATA).toContain(pipeline)
    }
  })
})

describe("starter job budget estimate", () => {
  it("bounds its one producer call's abort ceiling (300s) plus the dossier build", () => {
    // shouldDeferJob asks "can this finish in the time I have left?", so an estimate under the
    // real tail lets the worker start a job that overruns maxDuration and zombies.
    expect(estimatePipelineMs(FIRST_RUN_STARTER)).toBeGreaterThan(300_000)
  })
  it("stays cheaper than the heavy data pulls, so it is startable late in an invocation", () => {
    expect(estimatePipelineMs(FIRST_RUN_STARTER)).toBeLessThan(estimatePipelineMs("content"))
    expect(estimatePipelineMs(FIRST_RUN_STARTER)).toBeLessThan(estimatePipelineMs("brief"))
  })
})

describe("FIRST_RUN_DRAIN_CONCURRENCY", () => {
  it("is clamped to a sane band: the data vendors are not governed the way Anthropic is", () => {
    expect(FIRST_RUN_DRAIN_CONCURRENCY).toBeGreaterThanOrEqual(1)
    expect(FIRST_RUN_DRAIN_CONCURRENCY).toBeLessThanOrEqual(4)
  })
})
