// Pure-evaluator tests for the pipeline watchdog. No I/O — evaluatePipelineHealth turns
// already-fetched signals + "now" into a verdict, so every branch is testable directly.

import { describe, it, expect } from "vitest"
import { evaluatePipelineHealth, DEFAULT_THRESHOLDS, type PipelineSignals } from "@/lib/ops/pipeline-health"

const NOW = Date.parse("2026-06-22T13:00:00Z")
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

// A fully-healthy baseline; override one field per test.
const healthy = (over: Partial<PipelineSignals> = {}): PipelineSignals => ({
  lastRunAt: hoursAgo(1),
  lastDataAt: hoursAgo(2),
  lastBriefAt: hoursAgo(3),
  staleLocations: 0,
  stuckJobs: 0,
  failedJobsRecent: 0,
  staleQueuedJobs: 0,
  vendorDown: false,
  vendorPaymentRequired: false,
  fallbackSkillRate: 0,
  briefsAssessed: 0,
  rateLimitedRate: 0,
  rateLimitCallsSampled: 0,
  ...over,
})

describe("evaluatePipelineHealth — healthy", () => {
  it("returns ok with no reasons when everything is fresh", () => {
    const v = evaluatePipelineHealth(healthy(), NOW)
    expect(v.status).toBe("ok")
    expect(v.reasons).toEqual([])
    expect(v.checkedAt).toBe(new Date(NOW).toISOString())
    expect(v.hoursSinceLastRun).toBeCloseTo(1, 5)
  })
})

describe("evaluatePipelineHealth — DOWN (the silent-stall signature)", () => {
  it("flags DOWN when the queue has never run", () => {
    const v = evaluatePipelineHealth(healthy({ lastRunAt: null }), NOW)
    expect(v.status).toBe("down")
    expect(v.reasons.join(" ")).toMatch(/never run|crons dark/i)
  })
  it("flags DOWN when no pipeline run within the stale window", () => {
    const v = evaluatePipelineHealth(healthy({ lastRunAt: hoursAgo(30) }), NOW)
    expect(v.status).toBe("down")
    expect(v.reasons.join(" ")).toMatch(/No pipeline run in 30/)
  })
  it("flags DOWN when data is stale", () => {
    const v = evaluatePipelineHealth(healthy({ lastDataAt: hoursAgo(40) }), NOW)
    expect(v.status).toBe("down")
    expect(v.reasons.join(" ")).toMatch(/No fresh data/)
  })
  it("reproduces the 2026-06 incident: no run, ~16d-old data, ~13d-old brief", () => {
    const v = evaluatePipelineHealth(
      healthy({ lastRunAt: null, lastDataAt: hoursAgo(16 * 24), lastBriefAt: hoursAgo(13 * 24) }),
      NOW,
    )
    expect(v.status).toBe("down")
    expect(v.reasons.length).toBeGreaterThanOrEqual(2)
  })
})

describe("evaluatePipelineHealth — DEGRADED (running but not finishing cleanly)", () => {
  it("degrades when the brief is stale but data/runs are fresh", () => {
    const v = evaluatePipelineHealth(healthy({ lastBriefAt: hoursAgo(30) }), NOW)
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/No brief built/)
  })
  it("degrades when jobs are queued but not draining (worker stalled)", () => {
    const v = evaluatePipelineHealth(healthy({ staleQueuedJobs: 5 }), NOW)
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/not draining/)
  })
  it("degrades when jobs are stuck running", () => {
    expect(evaluatePipelineHealth(healthy({ stuckJobs: 2 }), NOW).status).toBe("degraded")
  })
  it("degrades only when failed jobs reach the threshold", () => {
    expect(evaluatePipelineHealth(healthy({ failedJobsRecent: DEFAULT_THRESHOLDS.failedJobsAlert - 1 }), NOW).status).toBe("ok")
    expect(evaluatePipelineHealth(healthy({ failedJobsRecent: DEFAULT_THRESHOLDS.failedJobsAlert }), NOW).status).toBe("degraded")
  })
  it("degrades on a DataForSEO outage and names the out-of-credits case", () => {
    const v = evaluatePipelineHealth(healthy({ vendorDown: true, vendorPaymentRequired: true }), NOW)
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/out of credits/i)
  })
  it("degrades on a PARTIAL-fleet stall (some locations stale) that the fleet-wide MAX would mask", () => {
    // lastRun/data/brief are all fresh (one healthy org), but 3 recently-active locations are stale.
    const v = evaluatePipelineHealth(healthy({ staleLocations: 3 }), NOW)
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/partial stall/)
  })
  it("does NOT alert on a single stale location (below the partial-stall threshold)", () => {
    expect(evaluatePipelineHealth(healthy({ staleLocations: 1 }), NOW).status).toBe("ok")
  })
})

describe("evaluatePipelineHealth — fleet-wide producer fallback (the 2026-06 truncation signature)", () => {
  it("degrades when producers are serving the deterministic floor above the threshold", () => {
    // Briefs BUILD (freshness all fine) but ~70% of producer slots fell back — the truncation bug.
    const v = evaluatePipelineHealth(healthy({ fallbackSkillRate: 0.7, briefsAssessed: 5 }), NOW)
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/serving deterministic fallbacks/i)
    expect(v.reasons.join(" ")).toMatch(/70%/)
  })
  it("does NOT alert on a single flaky skill (1 of ~9 ≈ 0.11, below the 0.4 threshold)", () => {
    expect(evaluatePipelineHealth(healthy({ fallbackSkillRate: 0.11, briefsAssessed: 5 }), NOW).status).toBe("ok")
  })
  it("does NOT alert when NO briefs carry skillHealth yet (pre-migration: can't judge)", () => {
    // Rate is 0 with 0 assessed — the field just isn't populated yet; must not read as healthy-proven
    // nor alert. A high rate with 0 assessed is impossible, but the gate is on briefsAssessed > 0.
    expect(evaluatePipelineHealth(healthy({ fallbackSkillRate: 0, briefsAssessed: 0 }), NOW).status).toBe("ok")
    expect(evaluatePipelineHealth(healthy({ fallbackSkillRate: 0.9, briefsAssessed: 0 }), NOW).status).toBe("ok")
  })
  it("fires exactly at the threshold boundary", () => {
    expect(evaluatePipelineHealth(healthy({ fallbackSkillRate: 0.4, briefsAssessed: 3 }), NOW).status).toBe("degraded")
    expect(evaluatePipelineHealth(healthy({ fallbackSkillRate: 0.39, briefsAssessed: 3 }), NOW).status).toBe("ok")
  })
})

describe("evaluatePipelineHealth — rate-ceiling pressure (the leading indicator)", () => {
  it("degrades when Anthropic rate-limits exceed the threshold with enough sample", () => {
    const v = evaluatePipelineHealth(healthy({ rateLimitedRate: 0.3, rateLimitCallsSampled: 50 }), NOW)
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/rate-limited \(429\/529\)/i)
    expect(v.reasons.join(" ")).toMatch(/30%/)
  })
  it("does NOT alert below a meaningful sample (a 1-of-2 spike can't trip it)", () => {
    expect(evaluatePipelineHealth(healthy({ rateLimitedRate: 1, rateLimitCallsSampled: 2 }), NOW).status).toBe("ok")
  })
  it("does NOT alert on an occasional, self-healing 429 rate", () => {
    expect(evaluatePipelineHealth(healthy({ rateLimitedRate: 0.05, rateLimitCallsSampled: 200 }), NOW).status).toBe("ok")
  })
  it("fires at the threshold boundary", () => {
    expect(evaluatePipelineHealth(healthy({ rateLimitedRate: 0.25, rateLimitCallsSampled: 40 }), NOW).status).toBe("degraded")
    expect(evaluatePipelineHealth(healthy({ rateLimitedRate: 0.24, rateLimitCallsSampled: 40 }), NOW).status).toBe("ok")
  })
})

describe("evaluatePipelineHealth — escalation", () => {
  it("takes the MOST severe signal (down beats degraded)", () => {
    // data stale (down) + vendor down (degraded) → overall down
    const v = evaluatePipelineHealth(healthy({ lastDataAt: hoursAgo(40), vendorDown: true }), NOW)
    expect(v.status).toBe("down")
  })
  it("respects a custom staleHours threshold", () => {
    const sig = healthy({ lastRunAt: hoursAgo(10) })
    expect(evaluatePipelineHealth(sig, NOW, { ...DEFAULT_THRESHOLDS, staleHours: 8 }).status).toBe("down")
    expect(evaluatePipelineHealth(sig, NOW, { ...DEFAULT_THRESHOLDS, staleHours: 26 }).status).toBe("ok")
  })
})
