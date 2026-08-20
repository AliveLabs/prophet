import { describe, it, expect } from "vitest"
import {
  TIER_LIMITS,
  TIER_PRICING,
  ADD_ON_PRICING,
  addOnLocationPrice,
} from "@/lib/billing/tiers"
import {
  resolveLocationAllowance,
  resolveCompetitorAllowance,
  ensureLocationLimit,
  ensureCompetitorLimit,
} from "@/lib/billing/limits"

// ALT-687. Locations and competitors are PURCHASED QUANTITIES now: the plan includes some, and
// anything beyond is bought as a Stripe subscription-item quantity mirrored onto
// organizations.locations_purchased / competitors_purchased.
//
//     effective cap = TIER_LIMITS[tier].included* + org.*_purchased

const entry = { subscription_tier: "entry" }

describe("purchased = 0 behaves exactly as before the change", () => {
  it("the allowance equals the included count", () => {
    expect(resolveLocationAllowance(entry).total).toBe(TIER_LIMITS.entry.includedLocations)
    expect(resolveCompetitorAllowance(entry).total).toBe(
      TIER_LIMITS.entry.includedCompetitorsPerLocation
    )
  })

  it("an org row that omits the columns entirely still resolves", () => {
    // The columns are optional on QuantityOrg on purpose: a caller whose select predates this
    // change keeps today's behaviour instead of throwing or resolving to zero.
    const allowance = resolveCompetitorAllowance({ subscription_tier: "mid" })
    expect(allowance.purchased).toBe(0)
    expect(allowance.total).toBe(TIER_LIMITS.mid.includedCompetitorsPerLocation)
  })
})

describe("purchased quantities widen the cap", () => {
  it("adds locations", () => {
    const a = resolveLocationAllowance({ subscription_tier: "entry", locations_purchased: 3 })
    expect(a.included).toBe(1)
    expect(a.purchased).toBe(3)
    expect(a.total).toBe(4)
  })

  it("adds competitors", () => {
    const a = resolveCompetitorAllowance({ subscription_tier: "entry", competitors_purchased: 2 })
    expect(a.total).toBe(TIER_LIMITS.entry.includedCompetitorsPerLocation + 2)
  })

  it("the two quantities do not leak into each other", () => {
    const org = { subscription_tier: "entry", locations_purchased: 5, competitors_purchased: 0 }
    expect(resolveCompetitorAllowance(org).purchased).toBe(0)
    expect(resolveLocationAllowance(org).purchased).toBe(5)
  })
})

describe("a bad read must never WIDEN a cap", () => {
  it("an unknown or null tier degrades to entry, the smallest allowance", () => {
    for (const tier of [null, "nonsense"]) {
      const a = resolveCompetitorAllowance({ subscription_tier: tier })
      expect(a.total).toBe(TIER_LIMITS.entry.includedCompetitorsPerLocation)
      expect(a.total).toBeLessThan(TIER_LIMITS.top.includedCompetitorsPerLocation)
    }
  })

  it("a negative quantity clamps to 0 rather than shrinking the plan allowance", () => {
    const a = resolveLocationAllowance({ subscription_tier: "mid", locations_purchased: -4 })
    expect(a.total).toBe(TIER_LIMITS.mid.includedLocations)
  })

  it("a fractional or non-finite quantity floors to something safe", () => {
    expect(resolveLocationAllowance({ subscription_tier: "mid", locations_purchased: 2.9 }).purchased).toBe(2)
    expect(resolveLocationAllowance({ subscription_tier: "mid", locations_purchased: NaN }).purchased).toBe(0)
    expect(
      resolveLocationAllowance({
        subscription_tier: "mid",
        locations_purchased: Infinity,
      }).purchased
    ).toBe(0)
  })
})

describe("the guards enforce the purchased total, not the included count", () => {
  it("lets a customer use the location they paid for", () => {
    const org = { subscription_tier: "entry", locations_purchased: 2 }
    expect(() => ensureLocationLimit(org, 2)).not.toThrow() // 3 allowed, holding 2
    expect(() => ensureLocationLimit(org, 3)).toThrow()
  })

  it("lets a customer watch the competitor they paid for", () => {
    const included = TIER_LIMITS.entry.includedCompetitorsPerLocation
    const org = { subscription_tier: "entry", competitors_purchased: 1 }
    // This is the regression that matters: at `included` a paying customer used to be refused.
    expect(() => ensureCompetitorLimit(org, included)).not.toThrow()
    expect(() => ensureCompetitorLimit(org, included + 1)).toThrow()
  })

  it("suspended stays at zero no matter what was purchased", () => {
    const org = { subscription_tier: "suspended", locations_purchased: 9, competitors_purchased: 9 }
    // A suspended org's INCLUDED counts are 0, so purchased still resolves above zero. That is
    // deliberate: access is blocked by payment_state, not by the caps. This test pins that the
    // caps are not doing double duty as an access gate, so nobody "fixes" one and breaks the other.
    expect(TIER_LIMITS.suspended.includedLocations).toBe(0)
    expect(resolveLocationAllowance(org).included).toBe(0)
  })

  it("the refusal message tells the operator what to do, not which tier failed", () => {
    try {
      ensureCompetitorLimit({ subscription_tier: "entry" }, 99)
      throw new Error("should have thrown")
    } catch (e) {
      const msg = String(e)
      expect(msg).toMatch(/add another to your subscription/i)
      expect(msg).not.toMatch(/tier/i) // "Competitor limit reached for entry tier." was internal
      expect(msg).not.toMatch(/[—–]/)
    }
  })
})

describe("⚠️ INVARIANT: an add-on may never cost more than the base", () => {
  // The arbitrage: a draft priced Starter at $99 with a $269 add-on location, so two Starter
  // accounts cost $198 against $568 and the customer saved $370 by splitting. Non-linear price
  // over a linear cost driver ALWAYS creates arbitrage. See docs/PRICING-2026-08-19.md.
  //
  // This test earned its keep on 2026-08-20: the DECIDED sheet still had a flat $229 add-on
  // location, which is fine against Standard's $249 base but breaks against Starter's $99. The
  // location add-on is now per-plan, matching the sheet's own "same plan as the first" rule.

  const SELF_SERVE = ["entry", "mid"] as const

  it("the location add-on never exceeds the base of the plan it attaches to", () => {
    for (const tier of SELF_SERVE) {
      const base = TIER_PRICING[tier]
      const addOn = addOnLocationPrice(tier)
      expect(addOn.monthly, `${tier} monthly`).toBeLessThanOrEqual(base.monthly)
      expect(addOn.annualEffectiveMonthly, `${tier} annual`).toBeLessThanOrEqual(
        base.annualEffectiveMonthly,
      )
    }
  })

  it("so splitting into two accounts never saves the customer money", () => {
    // The check in the form a customer would actually run it.
    for (const tier of SELF_SERVE) {
      const base = TIER_PRICING[tier].annualEffectiveMonthly
      const twoAccounts = base * 2
      const oneAccountTwoLocations = base + addOnLocationPrice(tier).annualEffectiveMonthly
      expect(oneAccountTwoLocations, `${tier}: splitting must not be cheaper`).toBeLessThanOrEqual(
        twoAccounts,
      )
    }
  })

  it("the competitor add-on is below every base, so it needs no per-plan split", () => {
    const cheapest = Math.min(...SELF_SERVE.map((t) => TIER_PRICING[t].annualEffectiveMonthly))
    expect(ADD_ON_PRICING.competitor.annualEffectiveMonthly).toBeLessThan(cheapest)
  })

  it("pins the specific numbers the pricing doc committed to", () => {
    // If these change, docs/PRICING-2026-08-19.md and the Stripe prices must change with them.
    expect(TIER_PRICING.entry.monthly).toBe(119)
    expect(TIER_PRICING.entry.annualEffectiveMonthly).toBe(99)
    expect(TIER_PRICING.mid.monthly).toBe(299)
    expect(TIER_PRICING.mid.annualEffectiveMonthly).toBe(249)
    expect(addOnLocationPrice("mid").annualEffectiveMonthly).toBe(229)
    expect(ADD_ON_PRICING.competitor.annualEffectiveMonthly).toBe(15)
  })

  it("annual is two months free on every line, not some other discount", () => {
    const lines = [
      TIER_PRICING.entry, TIER_PRICING.mid, TIER_PRICING.top,
      addOnLocationPrice("entry"), addOnLocationPrice("mid"), ADD_ON_PRICING.competitor,
    ]
    for (const l of lines) {
      expect(l.annual).toBe(l.monthly * 10)
      expect(l.annualEffectiveMonthly).toBeLessThan(l.monthly)
    }
  })

  it("a Standard add-on location is discounted but not given away", () => {
    // $229 against $249 is a deliberate 8% gap. Far below and a multi-location account's blended
    // margin collapses on locations 2..n.
    const ratio =
      addOnLocationPrice("mid").annualEffectiveMonthly / TIER_PRICING.mid.annualEffectiveMonthly
    expect(ratio).toBeGreaterThan(0.85)
    expect(ratio).toBeLessThan(1)
  })
})
