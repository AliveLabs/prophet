// ---------------------------------------------------------------------------
// Fleet daily spend cap (ALT-543 step 7).
//
// This is the only guard in the programme that can HALT the product, so its failure modes matter
// more than its happy path. Two properties are load-bearing:
//
//   1. FAILS OPEN. If the spend query errors, briefs must still build. A cost guard that halts the
//      product because a SELECT failed is a worse outage than the overspend it prevents.
//   2. DISABLED BY DEFAULT. An unset cap must never halt anything, so shipping it cannot break
//      production before anyone has picked a number.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, afterEach } from "vitest"
import {
  checkFleetSpend,
  describeFleetSpend,
  utcDateKey,
  FLEET_DAILY_CAP_USD,
  type FleetBudgetStore,
} from "@/lib/ai/fleet-budget"

afterEach(() => vi.restoreAllMocks())

/** Supabase stub: `.from().select().eq()` resolves to the supplied result. */
function storeOf(result: { data?: unknown[]; error?: { message: string } } | (() => never)): FleetBudgetStore {
  return {
    from: vi.fn(() => {
      if (typeof result === "function") result()
      const c: Record<string, unknown> = {}
      c.select = vi.fn(() => c)
      c.eq = vi.fn(() => Promise.resolve(result))
      return c
    }),
  } as unknown as FleetBudgetStore
}

const briefRow = (usd: number | undefined) => ({ brief: { providerStats: usd === undefined ? {} : { estimatedUsd: usd } } })

describe("default posture", () => {
  it("ships DISABLED — an unset cap can never halt a build", async () => {
    if (!process.env.ANTHROPIC_FLEET_DAILY_CAP_USD) expect(FLEET_DAILY_CAP_USD).toBeNull()
    const check = await checkFleetSpend(storeOf({ data: [briefRow(9999)] }), { capUsd: null })
    expect(check.exceeded).toBe(false)
    expect(check.capUsd).toBeNull()
  })

  it("does not even query when no cap is configured", async () => {
    const store = storeOf({ data: [] })
    await checkFleetSpend(store, { capUsd: null })
    expect(store.from).not.toHaveBeenCalled()
  })
})

describe("fails open", () => {
  it("does NOT halt when the spend query errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const check = await checkFleetSpend(storeOf({ error: { message: "connection reset" } }), { capUsd: 10 })
    expect(check.exceeded).toBe(false) // the product keeps working
    expect(check.spentUsd).toBeNull() // and is honest that it does not know
    expect(warn).toHaveBeenCalled()
  })

  it("does NOT halt when the store throws outright", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const check = await checkFleetSpend(
      storeOf(() => {
        throw new Error("boom")
      }),
      { capUsd: 10 },
    )
    expect(check.exceeded).toBe(false)
    expect(check.spentUsd).toBeNull()
  })
})

describe("summing today's spend", () => {
  it("adds estimatedUsd across briefs and trips at or past the cap", async () => {
    const check = await checkFleetSpend(storeOf({ data: [briefRow(4), briefRow(3.5), briefRow(2.5)] }), { capUsd: 10 })
    expect(check.spentUsd).toBeCloseTo(10)
    expect(check.briefs).toBe(3)
    expect(check.exceeded).toBe(true) // at the cap counts as reached
  })

  it("stays under when spend is below the cap", async () => {
    const check = await checkFleetSpend(storeOf({ data: [briefRow(1), briefRow(2)] }), { capUsd: 10 })
    expect(check.spentUsd).toBeCloseTo(3)
    expect(check.exceeded).toBe(false)
  })

  it("ignores rows with no estimate rather than counting them as zero spend", async () => {
    // Pre-step-2 briefs carry no estimatedUsd. They must not inflate the brief count, which is the
    // sanity check a human reads to decide whether the total is believable.
    const check = await checkFleetSpend(storeOf({ data: [briefRow(5), briefRow(undefined), { brief: null }] }), {
      capUsd: 10,
    })
    expect(check.spentUsd).toBeCloseTo(5)
    expect(check.briefs).toBe(1)
  })

  it("treats an empty day as zero spend, not unknown", async () => {
    const check = await checkFleetSpend(storeOf({ data: [] }), { capUsd: 10 })
    expect(check.spentUsd).toBe(0)
    expect(check.exceeded).toBe(false)
  })
})

describe("utcDateKey", () => {
  it("is the UTC calendar day, matching how date_key is written", () => {
    expect(utcDateKey(new Date("2026-08-01T23:59:59Z"))).toBe("2026-08-01")
    expect(utcDateKey(new Date("2026-08-02T00:00:01Z"))).toBe("2026-08-02")
  })
})

describe("describeFleetSpend", () => {
  it("distinguishes disabled, unknown, and known", () => {
    expect(describeFleetSpend({ spentUsd: null, capUsd: null, exceeded: false, briefs: 0 })).toContain("disabled")
    expect(describeFleetSpend({ spentUsd: null, capUsd: 10, exceeded: false, briefs: 0 })).toContain("failing open")
    expect(describeFleetSpend({ spentUsd: 3, capUsd: 10, exceeded: false, briefs: 2 })).toContain("$3.00 of $10.00")
  })
})
