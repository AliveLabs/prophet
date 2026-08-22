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
import { TIER_LIMITS } from "@/lib/billing/tiers"

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

// ── ALT-688 ─────────────────────────────────────────────────────────────────────────────────
//
// `force` used to have TWO callers: an explicit ?location_id= request, and an active trial. The
// trial one is gone. A trial was getting a DAILY search pull, which no paid tier gets at any
// price, so it delivered more than the plan being trialled and then took it away at conversion.
// Costed at $1.13/location-day: $15.82 of search data per 14-day trial against ~$4.14 at weekly.
//
// A test here used to be NAMED "an active trial runs every day (an evaluator watching stale data
// churns)". It only ever exercised `force: true`, so it kept passing after the bypass was removed
// while its name went on documenting the deleted behaviour as the contract. That name was the
// regression risk, not the assertion. Naming a test after a REASON rather than the input it
// passes is how that happens.
describe("isSeoDue — force is an ops lever, and the ONLY one", () => {
  it("force bypasses the cadence on every day of the week", () => {
    for (const d of [SUN, MON, TUE, WED, THU, FRI, SAT]) {
      expect(isSeoDue("weekly", d, { force: true }), `day ${d}`).toBe(true)
    }
    expect(isSeoDue("biweekly", SUN, { force: true })).toBe(true)
  })

  it("its only caller is an explicit ?location_id= request, never a trial", () => {
    // Enforced by the compiler rather than by this assertion: the opts type is `{ force?: boolean }`
    // and the route passes `{ force: !!singleLocationId }`. There is no trial-shaped field to set,
    // so re-adding the bypass cannot be a one-word change. This documents the intent so the next
    // person reads the ticket instead of restoring the old behaviour from the old test name.
    expect(isSeoDue("weekly", SAT, { force: false })).toBe(false)
    expect(isSeoDue("weekly", SAT, {})).toBe(false)
  })

  it("NO tier's declared cadence can produce a daily search pull", () => {
    // The actual thing that went wrong was not "trials bypass a gate", it was "something in the
    // system pulls search data daily when nothing is priced for daily". So assert it of every
    // cadence any tier can declare, driven off TIER_LIMITS rather than a hand-typed list: if a
    // future tier declares a third cadence, this fails until someone prices it.
    const declared = new Set(Object.values(TIER_LIMITS).map((t) => t.seoCadence))
    expect(declared.size).toBeGreaterThan(0)
    for (const cadence of declared) {
      const perWeek = [SUN, MON, TUE, WED, THU, FRI, SAT].filter((d) => isSeoDue(cadence, d)).length
      expect(perWeek, `cadence ${cadence}`).toBeLessThanOrEqual(2)
      expect(perWeek, `cadence ${cadence}`).toBeGreaterThan(0)
    }
  })
})
