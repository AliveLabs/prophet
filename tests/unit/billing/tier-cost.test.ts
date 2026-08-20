// ALT-668 — cost to serve, per tier.
//
// These pin the two things that made the earlier reading of this problem wrong:
//
//   1. The model must use the ENFORCED cadence. `seoLabsCadence` says the top tier is "daily" and
//      has ZERO readers in the codebase; `seoCadence` says "biweekly" and is what `isSeoDue`
//      actually gates on. Pricing off the dead field produces a different answer.
//   2. Per-location limits must multiply. The daily cron loops locations and gates SEO per
//      location, so a 3-location org pays three times over.
//
// The dollar figures come from lib/billing/cost-model.ts's verified provider unit prices. They are
// bottom-up projections, not observed invoices, and the assertions are deliberately banded rather
// than exact so a unit-price correction does not read as a regression.

import { describe, it, expect } from "vitest"
import {
  estimateTierCost,
  tierLoadMultiple,
  fixedFloorPerSubscriberUsd,
  VARIABLE_MARGIN_BANDS,
  OBSERVED_USD_PER_BRIEF,
} from "@/lib/billing/tier-cost"
import { TIER_LIMITS, TIER_PRICING } from "@/lib/billing/tiers"
import { RUNS_PER_MONTH } from "@/lib/billing/cost-model"

describe("estimateTierCost — inputs come from enforced limits", () => {
  it("derives every input from TIER_LIMITS rather than restating it", () => {
    for (const tier of ["entry", "mid", "top"] as const) {
      const e = estimateTierCost(tier)
      const l = TIER_LIMITS[tier]
      expect(e.inputs.locations).toBe(l.includedLocations)
      expect(e.inputs.competitorsPerLocation).toBe(l.includedCompetitorsPerLocation)
      expect(e.inputs.ownSocialNetworks).toBe(l.ownSocialNetworkLimit)
      expect(e.inputs.seoCadence).toBe(l.seoCadence)
      expect(e.priceUsd).toBe(TIER_PRICING[tier].monthly)
    }
  })

  it("uses the top tier's biweekly SEO cadence, not the dead 'daily' seoLabsCadence field", () => {
    // If this ever reads 30 runs/mo, someone has priced off seoLabsCadence again.
    const top = estimateTierCost("top")
    expect(top.inputs.seoCadence).toBe("biweekly")
    expect(top.inputs.seoRunsPerMonth).toBeCloseTo(RUNS_PER_MONTH.biweekly, 5)
    expect(top.inputs.seoRunsPerMonth).toBeGreaterThan(RUNS_PER_MONTH.weekly)
    expect(top.inputs.seoRunsPerMonth).toBeLessThan(RUNS_PER_MONTH.daily)
  })

  it("reads brief cadence from runCadence, the same field the cron gates on (ALT-683)", () => {
    expect(estimateTierCost("entry").inputs.briefCadence).toBe("weekly")
    expect(estimateTierCost("mid").inputs.briefCadence).toBe("daily")
    expect(estimateTierCost("top").inputs.briefCadence).toBe("daily")
  })

  it("multiplies the whole cost by locations, because every pull is per location", () => {
    const top = estimateTierCost("top")
    expect(top.inputs.locations).toBe(3)
    expect(top.totalVariableUsd).toBeCloseTo(top.perLocationUsd * 3, 1)
    expect(top.notes.some((n) => n.includes("PER LOCATION"))).toBe(true)
  })

  it("does not multiply a single-location tier", () => {
    const mid = estimateTierCost("mid")
    expect(mid.totalVariableUsd).toBe(mid.perLocationUsd)
    expect(mid.notes.some((n) => n.includes("PER LOCATION"))).toBe(false)
  })
})

describe("estimateTierCost — the verdict on each price point", () => {
  it("entry and mid clear on variable cost", () => {
    for (const tier of ["entry", "mid"] as const) {
      const e = estimateTierCost(tier)
      expect(e.verdict).toBe("healthy")
      expect(e.variableMarginPct).toBeGreaterThan(VARIABLE_MARGIN_BANDS.healthy * 100)
    }
  })

  it("top is UNDERWATER at $499: this is the finding the ticket exists for", () => {
    // ~$258 of variable cost against a $499 price, at 3 locations x 10 competitors with daily
    // briefs. Positive, but under half the price left BEFORE any fixed cost, support or CAC.
    const top = estimateTierCost("top")
    expect(top.verdict).toBe("underwater")
    expect(top.totalVariableUsd).toBeGreaterThan(240)
    expect(top.totalVariableUsd).toBeLessThan(280)
    expect(top.variableMarginPct).toBeLessThan(VARIABLE_MARGIN_BANDS.underwater * 100)
  })

  it("names the driver: Claude is the majority of the top tier's cost", () => {
    // 30 briefs x 3 locations x $1.77. Not the search volume everyone assumed.
    const top = estimateTierCost("top")
    expect(top.bySourceUsd.claude).toBeGreaterThan(top.totalVariableUsd * 0.5)
    expect(top.bySourceUsd.claude).toBeCloseTo(OBSERVED_USD_PER_BRIEF.avg * 30 * 3, 0)
  })

  it("the measured $/brief is what flips top, not the modelled one", () => {
    // Guards against anyone quietly reverting to cost-model's ~$0.24/brief, which understates
    // Anthropic ~7x and makes $499 look comfortable.
    const observed = estimateTierCost("top")
    const modelled = estimateTierCost("top", { usdPerBrief: null })
    expect(modelled.verdict).toBe("healthy")
    expect(observed.verdict).toBe("underwater")
    expect(observed.totalVariableUsd).toBeGreaterThan(modelled.totalVariableUsd * 2)
  })

  it("the p95 account is worse still", () => {
    const p95 = estimateTierCost("top", { usdPerBrief: OBSERVED_USD_PER_BRIEF.p95 })
    expect(p95.verdict).toBe("underwater")
    expect(p95.variableMarginPct).toBeLessThan(
      estimateTierCost("top").variableMarginPct,
    )
  })

  it("top sells locations for HALF what mid does while costing more each to serve", () => {
    // The cleanest statement of the pricing problem: mid is $299 for one location, top is $499 for
    // three, i.e. ~$166 each — yet a top location costs MORE to serve than a mid one (more
    // competitors, more keywords, denser SEO cadence).
    const mid = estimateTierCost("mid")
    const top = estimateTierCost("top")
    const topPerLocationPrice = top.priceUsd / top.inputs.locations
    expect(topPerLocationPrice).toBeLessThan(mid.priceUsd * 0.6)
    expect(top.perLocationUsd).toBeGreaterThan(mid.perLocationUsd)
  })

  it("costs rise monotonically with the tier", () => {
    const [entry, mid, top] = (["entry", "mid", "top"] as const).map((t) => estimateTierCost(t))
    expect(mid.totalVariableUsd).toBeGreaterThan(entry.totalVariableUsd)
    expect(top.totalVariableUsd).toBeGreaterThan(mid.totalVariableUsd)
  })

  it("prices annual off the effective monthly, so the discount is not hidden", () => {
    const monthly = estimateTierCost("top")
    const annual = estimateTierCost("top", { cadence: "annual" })
    expect(annual.priceUsd).toBe(TIER_PRICING.top.annualEffectiveMonthly)
    expect(annual.priceUsd).toBeLessThan(monthly.priceUsd)
    // Same cost to serve, lower price, so annual margin is strictly worse.
    expect(annual.totalVariableUsd).toBe(monthly.totalVariableUsd)
    expect(annual.variableMarginPct).toBeLessThan(monthly.variableMarginPct)
  })
})

describe("tierLoadMultiple — does the price keep up with the load?", () => {
  it("top costs 1.67x mid in price but ~24x in search volume", () => {
    // THIS is the answer to the ticket's central question, and it is not the ~28x an earlier pass
    // guessed from seoLabsCadence — it lands near it by coincidence, via 4x keywords x 3 locations
    // x 2x cadence rather than via a daily pull.
    const m = tierLoadMultiple("top", "mid")
    expect(m.price).toBeCloseTo(1.67, 2)
    expect(m.seoVolume).toBeGreaterThan(20)
    expect(m.seoVolume).toBeLessThan(30)
    expect(m.entities).toBeCloseTo(5.5, 1)
    expect(m.briefs).toBeCloseTo(3, 1)
    // The load outruns the price on every axis. That is the finding.
    expect(m.seoVolume).toBeGreaterThan(m.price)
    expect(m.entities).toBeGreaterThan(m.price)
    expect(m.briefs).toBeGreaterThan(m.price)
  })

  it("top vs entry clears 79x search volume for 3.35x the price", () => {
    const m = tierLoadMultiple("top", "entry")
    expect(m.price).toBeCloseTo(3.35, 2)
    expect(m.seoVolume).toBeGreaterThan(75)
  })

  it("mid is the only step where the price nearly keeps pace on entities", () => {
    const m = tierLoadMultiple("mid", "entry")
    expect(m.price).toBeCloseTo(2.01, 2)
    expect(m.entities).toBeCloseTo(1.5, 1)
    expect(m.entities).toBeLessThan(m.price)
    // Briefs jump 7x though — weekly digest to daily is the real step change at this boundary.
    expect(m.briefs).toBeGreaterThan(6)
  })
})

describe("fixedFloorPerSubscriberUsd — the number that actually decides this", () => {
  it("spreads a fixed monthly floor across subscribers", () => {
    expect(fixedFloorPerSubscriberUsd(1118, 10)).toBeCloseTo(111.8, 1)
    expect(fixedFloorPerSubscriberUsd(1118, 100)).toBeCloseTo(11.18, 1)
  })

  it("returns null rather than Infinity at zero subscribers", () => {
    expect(fixedFloorPerSubscriberUsd(1118, 0)).toBeNull()
    expect(fixedFloorPerSubscriberUsd(1118, -1)).toBeNull()
  })

  it("entry cannot carry the fixed floor at a handful of subscribers", () => {
    // Entry has only $149 to cover a share of the Data365 standard plan plus infra, and cannot
    // until the base is big enough. This is a subscriber-count problem, not a price problem.
    const entry = estimateTierCost("entry")
    const floorAt5 = fixedFloorPerSubscriberUsd(1118, 5) as number
    expect(entry.totalVariableUsd + floorAt5).toBeGreaterThan(entry.priceUsd)

    const floorAt25 = fixedFloorPerSubscriberUsd(1118, 25) as number
    expect(entry.totalVariableUsd + floorAt25).toBeLessThan(entry.priceUsd)
  })

  it("top never reaches a healthy margin, even once fixed cost is spread thin", () => {
    // The distinction that decides the recommendation: entry and mid are fixed-floor problems that
    // scale away, top is a variable-cost problem that does not.
    const top = estimateTierCost("top")
    const floorAt50 = fixedFloorPerSubscriberUsd(1118, 50) as number
    const loaded = top.totalVariableUsd + floorAt50
    expect(loaded).toBeLessThan(top.priceUsd)
    expect((top.priceUsd - loaded) / top.priceUsd).toBeLessThan(0.5)

    const entry = estimateTierCost("entry")
    const entryLoaded = entry.totalVariableUsd + floorAt50
    expect((entry.priceUsd - entryLoaded) / entry.priceUsd).toBeGreaterThan(0.7)
  })
})
