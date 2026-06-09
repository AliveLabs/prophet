import { describe, it, expect } from "vitest"
import { shouldPull } from "@/lib/jobs/cadence"

const NOW = "2026-06-09T12:00:00Z"

describe("shouldPull — Data365 billing cadence", () => {
  it("always pulls on force or first run", () => {
    expect(shouldPull({ lastCapturedAt: NOW, lastContentAsOf: NOW, mode: "daily", force: true, now: NOW }).pull).toBe(true)
    expect(shouldPull({ lastCapturedAt: NOW, lastContentAsOf: NOW, mode: "first_run", now: NOW }).pull).toBe(true)
  })

  it("pulls when never pulled before", () => {
    expect(shouldPull({ lastCapturedAt: null, lastContentAsOf: null, mode: "daily", now: NOW }).pull).toBe(true)
  })

  it("skips a profile pulled a few hours ago (daily cadence)", () => {
    const r = shouldPull({
      lastCapturedAt: "2026-06-09T06:00:00Z", // 6h ago
      lastContentAsOf: "2026-06-08T00:00:00Z", // recent content → not dormant
      mode: "daily",
      now: NOW,
    })
    expect(r.pull).toBe(false)
  })

  it("pulls when the daily cadence window has elapsed", () => {
    const r = shouldPull({
      lastCapturedAt: "2026-06-08T10:00:00Z", // ~26h ago
      lastContentAsOf: "2026-06-07T00:00:00Z",
      mode: "daily",
      now: NOW,
    })
    expect(r.pull).toBe(true)
  })

  it("re-checks dormant accounts only on a long cadence (credit saver)", () => {
    // last content 2 years old → dormant; pulled 3 days ago → still within the 14-day dormant cadence
    const r = shouldPull({
      lastCapturedAt: "2026-06-06T12:00:00Z", // 3 days ago
      lastContentAsOf: "2024-01-01T00:00:00Z", // dormant
      mode: "daily",
      now: NOW,
    })
    expect(r.pull).toBe(false)
    expect(r.reason).toContain("dormant")
  })

  it("does eventually re-check a dormant account after the long cadence", () => {
    const r = shouldPull({
      lastCapturedAt: "2026-05-20T12:00:00Z", // ~20 days ago > 14d
      lastContentAsOf: "2024-01-01T00:00:00Z",
      mode: "daily",
      now: NOW,
    })
    expect(r.pull).toBe(true)
  })
})
