// Pure-evaluator tests for the pipeline watchdog. No I/O — evaluatePipelineHealth turns
// already-fetched signals + "now" into a verdict, so every branch is testable directly.

import { describe, it, expect } from "vitest"
import { evaluatePipelineHealth, computeBriefDrainP95Ms, DEFAULT_THRESHOLDS, type PipelineSignals } from "@/lib/ops/pipeline-health"

const NOW = Date.parse("2026-06-22T13:00:00Z")
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

// A fully-healthy baseline; override one field per test.
const healthy = (over: Partial<PipelineSignals> = {}): PipelineSignals => ({
  lastRunAt: hoursAgo(1),
  lastDataAt: hoursAgo(2),
  lastBriefAt: hoursAgo(3),
  staleLocations: 0,
  billingDarkLocations: 0,
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
  // Healthy baseline for the image mirror (ALT-666): nothing measured yet. Zeroes here mean
  // "no runs carried a tally", which must read as ok — a pre-ALT-666 fleet is not a collapsed one.
  mirrorCollapsedRuns: 0,
  mirrorRunsSampled: 0,
  mirrorSuccessRate: 0,
  mirrorAttemptsSampled: 0,
  mirrorFailures: {},
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

  // 2026-08-03: two operators finished onboarding, abandoned Stripe checkout, and so had no trial
  // clock. cron/daily and cron/build-brief both skip a non-trial-active org, so their locations went
  // dark BY DESIGN — and paged the on-call as a "partial stall" while the pipeline was working.
  it("reports billing-dark locations as a warning and never pages on them", () => {
    const v = evaluatePipelineHealth(healthy({ billingDarkLocations: 4 }), NOW)
    expect(v.status).toBe("ok")
    expect(v.reasons).toEqual([])
    expect(v.warnings.join(" ")).toMatch(/not trial-active/)
  })

  it("keeps the two causes separate: a real stall still pages while billing-dark only warns", () => {
    const v = evaluatePipelineHealth(
      healthy({ staleLocations: 2, billingDarkLocations: 3 }),
      NOW,
    )
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/partial stall/)
    // The paging channel carries reasons only, so the billing note must not leak into it.
    expect(v.reasons.join(" ")).not.toMatch(/trial-active/)
    expect(v.warnings.join(" ")).toMatch(/not trial-active/)
    expect(v.billingDarkLocations).toBe(3)
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
  it("degrades when eligible→done p95 stretches past the alert window", () => {
    const v = evaluatePipelineHealth(healthy({ briefDrainP95Ms: 3 * 3_600_000, briefDrainsSampled: 7 }), NOW)
    expect(v.status).toBe("degraded")
    expect(v.reasons.join(" ")).toMatch(/drain p95 is 3\.0h/)
    expect(v.reasons.join(" ")).toMatch(/isn't claiming eligible briefs fast enough/i)
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

describe("computeBriefDrainP95Ms — eligible→done, excludes intentional jitter", () => {
  const BASE = Date.parse("2026-07-19T07:00:00Z")
  const row = (createdMin: number, scheduledMin: number | null, doneMin: number) => ({
    created_at: new Date(BASE + createdMin * 60_000).toISOString(),
    scheduled_for: scheduledMin == null ? null : new Date(BASE + scheduledMin * 60_000).toISOString(),
    updated_at: new Date(BASE + doneMin * 60_000).toISOString(),
  })

  it("measures from scheduled_for, not created_at (the 2026-07-19 false-alarm shape)", () => {
    // All 9 briefs enqueued at once (created 0), then spread by within-zone jitter; each RUNS in minutes.
    // Measured enqueue→done this p95 is >2h (the false "degraded"); eligible→done it's minutes.
    const rows = [
      row(0, 7, 17), row(0, 14, 22), row(0, 28, 35), row(0, 35, 42), row(0, 42, 49),
      row(0, 49, 56), row(0, 50, 61), row(0, 97, 101), row(0, 112, 125),
    ]
    const { p95Ms, sampled } = computeBriefDrainP95Ms(rows)
    expect(sampled).toBe(9)
    expect(p95Ms).toBeLessThan(DEFAULT_THRESHOLDS.briefDrainAlertMs) // would NOT page
    expect(p95Ms).toBeLessThanOrEqual(15 * 60_000) // minutes, not hours
  })

  it("falls back to created_at when scheduled_for is null", () => {
    expect(computeBriefDrainP95Ms([row(0, null, 30)]).p95Ms).toBe(30 * 60_000)
  })

  it("drops negative drains and returns 0/0 when empty", () => {
    expect(computeBriefDrainP95Ms([])).toEqual({ p95Ms: 0, sampled: 0 })
    // scheduled_for after done (clock skew) → dropped, not a negative drain.
    expect(computeBriefDrainP95Ms([row(0, 40, 30)])).toEqual({ p95Ms: 0, sampled: 0 })
  })

  it("still fires on a genuine backlog (eligible→done actually long)", () => {
    const rows = Array.from({ length: 5 }, () => row(0, 0, 180)) // eligible immediately, done 3h later
    const { p95Ms } = computeBriefDrainP95Ms(rows)
    expect(p95Ms).toBe(180 * 60_000)
    expect(p95Ms).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.briefDrainAlertMs)
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

// ── ALT-666: social image mirror ──────────────────────────────────────────────
// The alerting-overhaul posture applied to a new signal: page on a collapse, warn on
// degradation, and stay completely silent on routine expired-URL churn.
describe("evaluatePipelineHealth — social image mirror", () => {
  it("stays ok and silent when no run carried a tally (pre-ALT-666 fleet)", () => {
    const v = evaluatePipelineHealth(healthy({ mirrorRunsSampled: 0, mirrorAttemptsSampled: 0 }), NOW)
    expect(v.status).toBe("ok")
    expect(v.reasons).toEqual([])
    expect(v.warnings).toEqual([])
  })

  it("stays ok on the healthy ~97% rate — expired CDN URLs must never page", () => {
    const v = evaluatePipelineHealth(
      healthy({
        mirrorRunsSampled: 9,
        mirrorAttemptsSampled: 900,
        mirrorSuccessRate: 0.97,
        mirrorFailures: { http_403: 27 },
      }),
      NOW,
    )
    expect(v.status).toBe("ok")
    expect(v.warnings).toEqual([])
  })

  it("does not page on ONE collapsed run — a single unreachable CDN is not a fleet fault", () => {
    const v = evaluatePipelineHealth(
      healthy({ mirrorCollapsedRuns: 1, mirrorRunsSampled: 9, mirrorAttemptsSampled: 900, mirrorSuccessRate: 0.86 }),
      NOW,
    )
    expect(v.status).toBe("ok")
    expect(v.reasons).toEqual([])
  })

  it("escalates to degraded once collapsed runs hit the threshold", () => {
    const v = evaluatePipelineHealth(
      healthy({
        mirrorCollapsedRuns: 9,
        mirrorRunsSampled: 9,
        mirrorAttemptsSampled: 900,
        mirrorSuccessRate: 0,
        mirrorFailures: { upload_error: 900 },
      }),
      NOW,
    )
    expect(v.status).toBe("degraded")
    expect(v.reasons.some((r) => r.includes("social image mirror collapsed on 9 of 9"))).toBe(true)
    // The failure breakdown is the difference between "the provider is down" and "our own
    // storage path is broken" — which is precisely the wrong conclusion drawn in 2026-07.
    expect(v.reasons.some((r) => r.includes("upload_error × 900"))).toBe(true)
  })

  it("warns without paging on a partial degradation", () => {
    const v = evaluatePipelineHealth(
      healthy({
        mirrorRunsSampled: 9,
        mirrorAttemptsSampled: 900,
        mirrorSuccessRate: 0.4,
        mirrorFailures: { http_403: 540 },
      }),
      NOW,
    )
    expect(v.status).toBe("ok")
    expect(v.reasons).toEqual([])
    expect(v.warnings.some((w) => w.includes("40% across 900 attempts"))).toBe(true)
  })

  it("will not warn off a sample too small to mean anything", () => {
    const v = evaluatePipelineHealth(
      healthy({ mirrorRunsSampled: 1, mirrorAttemptsSampled: 4, mirrorSuccessRate: 0.25 }),
      NOW,
    )
    expect(v.warnings).toEqual([])
  })

  it("carries the mirror signals through onto the verdict for the admin tile", () => {
    const v = evaluatePipelineHealth(
      healthy({ mirrorRunsSampled: 9, mirrorAttemptsSampled: 900, mirrorSuccessRate: 0.97, mirrorFailures: { http_403: 27 } }),
      NOW,
    )
    expect(v.mirrorRunsSampled).toBe(9)
    expect(v.mirrorAttemptsSampled).toBe(900)
    expect(v.mirrorSuccessRate).toBeCloseTo(0.97, 5)
    expect(v.mirrorFailures).toEqual({ http_403: 27 })
  })
})
