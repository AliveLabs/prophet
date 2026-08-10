// SEO cadence enforcement (2026-08-10).
//
// SEO/visibility ran DAILY for every location while EVERY tier declared it weekly, and while
// lib/billing/cost-model.ts priced it weekly (`RUNS_PER_MONTH { daily: 30, weekly: 4.3 }`).
// `seoCadence` lived in TIER_LIMITS and was read by exactly one consumer: the cost PROJECTION.
// No pipeline code enforced it, so the projection and the bill described different systems.
//
// Measured in prod: 127 snapshots per SEO provider across ~9 days for 14 locations — one per
// location per day — on the largest vendor line (~$400-500/mo, a $50 balance recharging every
// 3-5 days).

import { describe, it, expect } from "vitest"
import { isSeoDue } from "@/lib/jobs/build-schedule"

const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6

describe("isSeoDue — weekly tiers", () => {
  it("runs on Monday only", () => {
    expect(isSeoDue("weekly", MON)).toBe(true)
    for (const d of [SUN, TUE, WED, THU, FRI, SAT]) {
      expect(isSeoDue("weekly", d), `day ${d}`).toBe(false)
    }
  })

  it("is 1 run per week, not 7 — the whole point", () => {
    const runs = [SUN, MON, TUE, WED, THU, FRI, SAT].filter((d) => isSeoDue("weekly", d)).length
    expect(runs).toBe(1)
  })
})

describe("isSeoDue — biweekly means 2x per week", () => {
  it("runs Monday and Thursday", () => {
    expect(isSeoDue("biweekly", MON)).toBe(true)
    expect(isSeoDue("biweekly", THU)).toBe(true)
    for (const d of [SUN, TUE, WED, FRI, SAT]) {
      expect(isSeoDue("biweekly", d), `day ${d}`).toBe(false)
    }
  })

  it("is 2 runs per week", () => {
    const runs = [SUN, MON, TUE, WED, THU, FRI, SAT].filter((d) => isSeoDue("biweekly", d)).length
    expect(runs).toBe(2)
  })
})

describe("isSeoDue — force bypass", () => {
  it("an active trial runs every day (an evaluator watching stale data churns)", () => {
    for (const d of [SUN, MON, TUE, WED, THU, FRI, SAT]) {
      expect(isSeoDue("weekly", d, { force: true }), `day ${d}`).toBe(true)
    }
  })

  it("an explicitly requested single location bypasses the cadence", () => {
    expect(isSeoDue("weekly", SAT, { force: true })).toBe(true)
    expect(isSeoDue("biweekly", SUN, { force: true })).toBe(true)
  })

  it("no force means no bypass", () => {
    expect(isSeoDue("weekly", SAT, { force: false })).toBe(false)
    expect(isSeoDue("weekly", SAT, {})).toBe(false)
  })
})
