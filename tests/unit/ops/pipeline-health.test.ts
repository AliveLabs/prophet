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
  producerLatencyP95Ms: 0,
  latencySamples: 0,
  briefDrainP95Ms: 0,
  briefDrainsSampled: 0,
  ...over,
})

describe("evaluatePipelineHealth — healthy", () => {
  it("returns ok with no reasons/warnings when everything is fresh", () => {
    const v = evaluatePipelineHealth(healthy(), NOW)
    expect(v.status).toBe("ok")
    expect(v.reasons).toEqual([])
    expect(v.warnings).toEqual([])
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

describe("evaluatePipelineHealth — producer latency (CORROBORATING signal only, never pages alone)", () => {
  // 2026-07-08 false-alarm postmortem: elapsedMs includes governor slot-wait/retry backoff, not just
  // API time, so a healthy fleet legitimately runs p95 in the 240-300s band (a SUCCESSFUL call logged
  // 326s that morning). High latency alone must never page — only when paired with real fallback impact.
  it("high p95 with NO fallback impact is a WARNING, not a page — status stays ok", () => {
    const v = evaluatePipelineHealth(healthy({ producerLatencyP95Ms: 320_000, latencySamples: 30, fallbackSkillRate: 0, briefsAssessed: 5 }), NOW)
    expect(v.status).toBe("ok")
    expect(v.reasons).toEqual([])
    expect(v.warnings.join(" ")).toMatch(/p95 latency is 320s/)
    expect(v.warnings.join(" ")).toMatch(/not yet corroborated/i)
  })
  it("high p95 CORROBORATED by real fallback impact escalates and pages", () => {
    const v = evaluatePipelineHealth(healthy({ producerLatencyP95Ms: 320_000, latencySamples: 30, fallbackSkillRate: 0.2, briefsAssessed: 5 }), NOW)
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/p95 latency is 320s/)
    expect(v.reasons.join(" ")).toMatch(/20% fallback rate/)
    expect(v.warnings).toEqual([]) // promoted to reasons, not double-counted as a warning
  })
  it("does NOT surface anything below a meaningful sample (one slow brief can't trip it)", () => {
    // fallbackSkillRate 0.2 is ABOVE the corroboration bar (0.15) but below the standalone
    // fallbackRateAlert (0.4), so it isolates the latency signal's OWN sample gate.
    const v = evaluatePipelineHealth(healthy({ producerLatencyP95Ms: 320_000, latencySamples: 9, fallbackSkillRate: 0.2, briefsAssessed: 5 }), NOW)
    expect(v.status).toBe("ok")
    expect(v.warnings).toEqual([])
  })
  it("does NOT surface healthy latencies", () => {
    const v = evaluatePipelineHealth(healthy({ producerLatencyP95Ms: 90_000, latencySamples: 60 }), NOW)
    expect(v.status).toBe("ok")
    expect(v.warnings).toEqual([])
  })
  it("fires at the corrected (units-aware) threshold boundary — 300s, not the old 200s", () => {
    expect(evaluatePipelineHealth(healthy({ producerLatencyP95Ms: 300_000, latencySamples: 18, fallbackSkillRate: 0.2, briefsAssessed: 5 }), NOW).status).toBe("degraded")
    expect(evaluatePipelineHealth(healthy({ producerLatencyP95Ms: 299_999, latencySamples: 18, fallbackSkillRate: 0.2, briefsAssessed: 5 }), NOW).status).toBe("ok")
  })
  it("fires at the corroboration-rate boundary (0.15)", () => {
    expect(evaluatePipelineHealth(healthy({ producerLatencyP95Ms: 320_000, latencySamples: 30, fallbackSkillRate: 0.15, briefsAssessed: 5 }), NOW).status).toBe("degraded")
    expect(evaluatePipelineHealth(healthy({ producerLatencyP95Ms: 320_000, latencySamples: 30, fallbackSkillRate: 0.14, briefsAssessed: 5 }), NOW).status).toBe("ok")
  })
})

describe("evaluatePipelineHealth — brief queue drain stretch (the throughput ceiling)", () => {
  it("degrades when enqueue→done p95 stretches past the alert window", () => {
    const v = evaluatePipelineHealth(healthy({ briefDrainP95Ms: 3 * 3_600_000, briefDrainsSampled: 7 }), NOW)
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/drain p95 is 3\.0h/)
    expect(v.reasons.join(" ")).toMatch(/isn't keeping up/i)
  })
  it("does NOT alert below the minimum sample", () => {
    expect(evaluatePipelineHealth(healthy({ briefDrainP95Ms: 5 * 3_600_000, briefDrainsSampled: 2 }), NOW).status).toBe("ok")
  })
  it("does NOT alert on healthy drain times (minutes, not hours)", () => {
    expect(evaluatePipelineHealth(healthy({ briefDrainP95Ms: 20 * 60_000, briefDrainsSampled: 7 }), NOW).status).toBe("ok")
  })
  it("fires at the threshold boundary (2h)", () => {
    expect(evaluatePipelineHealth(healthy({ briefDrainP95Ms: 7_200_000, briefDrainsSampled: 3 }), NOW).status).toBe("degraded")
    expect(evaluatePipelineHealth(healthy({ briefDrainP95Ms: 7_199_999, briefDrainsSampled: 3 }), NOW).status).toBe("ok")
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
