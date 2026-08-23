// ALT-770 : the plan-change screen told a Multi-Location customer that Starter was an upgrade.
//
// The label came from `SELF_SERVE_TIERS.indexOf(t) > SELF_SERVE_TIERS.indexOf(currentTier)`.
// SELF_SERVE_TIERS is ["entry", "mid"] and does not contain "top", so with currentTier "top"
// `indexOf` returned -1 and BOTH tiles satisfied the comparison (0 > -1, 1 > -1). The button that
// changes what a customer pays was labelled the opposite of what it does.
//
// Not reachable in prod when it was filed (4 orgs on mid, 1 on entry, none on top: checked
// 2026-08-22) because Multi-Location is contract-only. It fires for the FIRST Multi-Location
// customer we sign, which is exactly when a wrong billing label costs the most.
//
// There was no test on this at all, which is why a -1 sat here unnoticed. The logic also lived
// inside a .tsx component, where vitest could never reach it.

import { describe, expect, it } from "vitest"
import { planChangeCta } from "@/lib/billing/plan-change-cta"
import {
  PAID_TIERS,
  SELF_SERVE_TIERS,
  planChangeDirection,
  type SubscriptionTier,
} from "@/lib/billing/tiers"

/** The tile as the billing screen renders it: not current, not loading, a different tier. */
const tile = (currentTier: unknown, tileTier: SubscriptionTier, displayName = "Starter") =>
  planChangeCta({
    isCurrentPlan: false,
    isLoading: false,
    isSameTier: false,
    cadence: "annual",
    direction: planChangeDirection(currentTier, tileTier),
    displayName,
  })

describe("the bug this ticket is about", () => {
  it("does NOT call Starter an upgrade for a Multi-Location customer", () => {
    expect(tile("top", "entry")).toBe("Downgrade →")
  })

  it("does NOT call Standard an upgrade for a Multi-Location customer", () => {
    expect(tile("top", "mid", "Standard")).toBe("Downgrade →")
  })

  it("reads Downgrade on EVERY self-serve tile when the customer is on top", () => {
    // The exact rendering loop: both tiles, one customer. This is the assertion the ticket asked
    // for, and the one the -1 made impossible.
    for (const t of SELF_SERVE_TIERS) {
      expect(tile("top", t), `tile ${t}`).toBe("Downgrade →")
    }
  })
})

describe("directions that were already right stay right", () => {
  it("entry to mid is an upgrade", () => {
    expect(tile("entry", "mid", "Standard")).toBe("Upgrade →")
  })

  it("mid to entry is a downgrade", () => {
    expect(tile("mid", "entry")).toBe("Downgrade →")
  })

  it("mid to top is an upgrade, ranked on entitlement rather than list price", () => {
    // top is CHEAPER than mid at list (the arbitrage documented on isSelfServeTier) and still
    // delivers strictly more. A customer reading "Upgrade" is being told about entitlement, and
    // that is the honest reading of the word. Ranking on price would invert this.
    expect(planChangeDirection("mid", "top")).toBe("upgrade")
  })
})

describe("an unrankable tier gets a neutral label, never a guessed direction", () => {
  it("names the destination when the current tier is unrecognised", () => {
    // subscription_tier is a DB column: a legacy or hand-edited value is a real input. The old
    // code would have ranked it -1 and confidently said "Upgrade".
    expect(tile("free", "entry")).toBe("Switch to Starter →")
    expect(tile("enterprise", "mid", "Standard")).toBe("Switch to Standard →")
  })

  it("names the destination for null and undefined", () => {
    expect(tile(null, "entry")).toBe("Switch to Starter →")
    expect(tile(undefined, "entry")).toBe("Switch to Starter →")
  })

  it("treats suspended as a state, not a rung", () => {
    // Moving off a suspended account is neither up nor down. Inventing a position for it is how
    // a wrong label gets rendered with confidence.
    expect(planChangeDirection("suspended", "mid")).toBe("unknown")
    expect(planChangeDirection("mid", "suspended")).toBe("unknown")
    expect(tile("suspended", "entry")).toBe("Switch to Starter →")
  })

  it("the neutral label is true regardless of what it replaced", () => {
    // The point of the fallback: whatever the customer is on, "Switch to X" does not claim a
    // direction. Assert it never leaks the words that would be a claim.
    const label = tile("something-new-we-added-later", "mid", "Standard")
    expect(label).not.toMatch(/upgrade|downgrade/i)
    expect(label).toContain("Standard")
  })
})

describe("planChangeDirection is total over the tiers that have a rank", () => {
  it("answers a direction for every ordered pair of paid tiers", () => {
    for (const from of PAID_TIERS) {
      for (const to of PAID_TIERS) {
        const d = planChangeDirection(from, to)
        expect(d, `${from} to ${to}`).not.toBe("unknown")
        if (from === to) expect(d).toBe("same")
      }
    }
  })

  it("is antisymmetric: if one way is an upgrade the other way is a downgrade", () => {
    // A ranking that is not antisymmetric can label both directions the same, which is precisely
    // what -1 did.
    for (const from of PAID_TIERS) {
      for (const to of PAID_TIERS) {
        if (from === to) continue
        const forward = planChangeDirection(from, to)
        const back = planChangeDirection(to, from)
        expect([forward, back].sort(), `${from} vs ${to}`).toEqual(["downgrade", "upgrade"])
      }
    }
  })

  it("covers top, which is the value SELF_SERVE_TIERS is missing", () => {
    // The root cause in one line: the old ranking source did not contain the tier being ranked.
    expect(SELF_SERVE_TIERS).not.toContain("top")
    expect(PAID_TIERS).toContain("top")
    expect(planChangeDirection("top", "entry")).toBe("downgrade")
  })
})

describe("the branches that come before direction", () => {
  const base = {
    isCurrentPlan: false,
    isLoading: false,
    isSameTier: false,
    cadence: "annual" as const,
    direction: "upgrade" as const,
    displayName: "Standard",
  }

  it("the current plan reads Current plan even while another tile is loading", () => {
    expect(planChangeCta({ ...base, isCurrentPlan: true, isLoading: true })).toBe("Current plan")
  })

  it("a tile mid-request reads Changing", () => {
    expect(planChangeCta({ ...base, isLoading: true })).toBe("Changing…")
  })

  it("the same tier on the other cadence is a billing-period switch, not a plan change", () => {
    // Same-tier tiles must never read Upgrade/Downgrade: nothing about the entitlement moved.
    expect(planChangeCta({ ...base, isSameTier: true, cadence: "annual" })).toBe(
      "Switch to annual →",
    )
    expect(planChangeCta({ ...base, isSameTier: true, cadence: "monthly" })).toBe(
      "Switch to monthly →",
    )
  })

  it("same-tier wins over direction, whatever the direction says", () => {
    for (const direction of ["upgrade", "downgrade", "unknown", "same"] as const) {
      const label = planChangeCta({ ...base, isSameTier: true, direction })
      expect(label, direction).toBe("Switch to annual →")
    }
  })
})

describe("no label claims a direction it cannot support", () => {
  it("every label is one of the six known strings", () => {
    // A guard against a future branch that returns something unreviewed into a billing button.
    const seen = new Set<string>()
    for (const isCurrentPlan of [true, false]) {
      for (const isLoading of [true, false]) {
        for (const isSameTier of [true, false]) {
          for (const cadence of ["monthly", "annual"] as const) {
            for (const direction of ["upgrade", "downgrade", "same", "unknown"] as const) {
              seen.add(
                planChangeCta({
                  isCurrentPlan,
                  isLoading,
                  isSameTier,
                  cadence,
                  direction,
                  displayName: "Standard",
                }),
              )
            }
          }
        }
      }
    }
    expect([...seen].sort()).toEqual([
      "Changing…",
      "Current plan",
      "Downgrade →",
      "Switch to Standard →",
      "Switch to annual →",
      "Switch to monthly →",
      "Upgrade →",
    ])
  })
})
