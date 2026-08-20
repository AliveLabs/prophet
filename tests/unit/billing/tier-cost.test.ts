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

  it("multiplies by locations when a tier includes more than one", () => {
    // No tier bundles locations any more (ALT-687: they are purchased), so this exercises the
    // multiplier directly rather than through `top`, which used to include 3.
    const one = estimateTierCost("mid")
    const three = estimateTierCost("mid", { locations: 3 })
    expect(three.inputs.locations).toBe(3)
    expect(three.totalVariableUsd).toBeCloseTo(one.perLocationUsd * 3, 1)
    expect(three.notes.some((n) => n.includes("PER LOCATION"))).toBe(true)
  })

  it("every tier now includes exactly one location", () => {
    for (const tier of ["entry", "mid", "top"] as const) {
      expect(estimateTierCost(tier).inputs.locations).toBe(1)
      expect(estimateTierCost(tier).notes.some((n) => n.includes("PER LOCATION"))).toBe(false)
    }
  })
})

describe("estimateTierCost — the verdict on each price point", () => {
  // ⚠️ REWRITTEN 2026-08-20 with the new sheet. The block this replaces pinned the ANALYSIS of a
  // price point that no longer exists: "$499 top is underwater at 3 bundled locations". That
  // finding was correct and it is why the $499 tier was deleted, but a test that asserts a deleted
  // price is underwater is asserting history, not behaviour. The reasoning lives in
  // docs/PRICING-2026-08-19.md and in [[ticket-tier-cost-to-serve-gap]].
  //
  // What survives here is the part that is still an invariant: the model must use the MEASURED
  // $/brief, and every self-serve price must clear on variable cost.

  it("every SELF-SERVE tier clears on variable cost", () => {
    for (const tier of ["entry", "mid"] as const) {
      const e = estimateTierCost(tier)
      expect(e.verdict).toBe("healthy")
      expect(e.variableMarginPct).toBeGreaterThan(VARIABLE_MARGIN_BANDS.healthy * 100)
    }
  })

  it("Multi-Location is priced PER LOCATION, so one unit is one location", () => {
    // This is what the old bundle model hid. `top` used to include 3 locations against a single
    // $499 price, so the model compared three locations' cost to one location's price. Under
    // per-location pricing every tier includes exactly one and the rest are purchased.
    const top = estimateTierCost("top")
    expect(top.inputs.locations).toBe(1)
    expect(top.totalVariableUsd).toBeCloseTo(top.perLocationUsd, 5)
  })

  it("the per-location contract rate covers a per-location cost", () => {
    // The floor that matters for a Multi-Location quote. $165/location on daily is the hard floor
    // in §5 of the pricing doc; the list rate has to sit comfortably above the cost of serving one.
    const top = estimateTierCost("top")
    expect(top.priceUsd).toBeGreaterThan(top.totalVariableUsd)
    expect(top.variableMarginPct).toBeGreaterThan(0)
  })

  it("names the driver: Claude is the majority of a daily location's cost", () => {
    // 30 briefs x 1 location x $1.77. Not the search volume everyone assumed.
    const top = estimateTierCost("top")
    expect(top.bySourceUsd.claude).toBeGreaterThan(top.totalVariableUsd * 0.5)
    expect(top.bySourceUsd.claude).toBeCloseTo(OBSERVED_USD_PER_BRIEF.avg * 30 * 1, 0)
  })

  it("the model uses the MEASURED $/brief, not the modelled one", () => {
    // The one assertion from the old block that is still load-bearing. cost-model.ts prices a
    // brief at ~$0.24; the Anthropic console says $1.77. Anyone reverting to the modelled figure
    // makes every tier look comfortable by about 7x on the largest line.
    const observed = estimateTierCost("top")
    const modelled = estimateTierCost("top", { usdPerBrief: null })
    expect(observed.totalVariableUsd).toBeGreaterThan(modelled.totalVariableUsd * 2)
    expect(observed.variableMarginPct).toBeLessThan(modelled.variableMarginPct)
  })

  it("the p95 account is worse than the average one", () => {
    const p95 = estimateTierCost("top", { usdPerBrief: OBSERVED_USD_PER_BRIEF.p95 })
    expect(p95.variableMarginPct).toBeLessThan(estimateTierCost("top").variableMarginPct)
  })

  it("a daily location costs more to serve than a weekly one, which is the price gap", () => {
    // The entire Starter-versus-Standard difference. If this ever inverts, the sheet is wrong.
    expect(estimateTierCost("mid").perLocationUsd).toBeGreaterThan(
      estimateTierCost("entry").perLocationUsd,
    )
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
  // ⚠️ REWRITTEN 2026-08-20. The old block compared BUNDLES: "top costs 1.67x mid in price but 24x
  // in search volume" was the sharpest statement of why $499-for-three-locations was mispriced,
  // and it is why that tier was deleted. With locations purchased separately, a tier-to-tier price
  // ratio no longer describes anything a customer buys, so those assertions were measuring a
  // structure that no longer exists. The finding is preserved in docs/PRICING-2026-08-19.md.
  //
  // What is still worth pinning: at the Starter-to-Standard step, the load must not outrun the
  // price. That is the one boundary a self-serve customer actually crosses.

  it("Starter to Standard: the price step covers the load step", () => {
    const m = tierLoadMultiple("mid", "entry")
    // $119 -> $299.
    expect(m.price).toBeCloseTo(299 / 119, 2)
    // Competitors 3 -> 5, so entities 4 -> 6.
    expect(m.entities).toBeCloseTo(1.5, 1)
    expect(m.entities).toBeLessThan(m.price)
    // Briefs are the real step change: weekly to daily is 7x, and it is the only axis that
    // outruns the price. That is deliberate and it is what the $180 gap is buying.
    expect(m.briefs).toBeGreaterThan(6)
    expect(m.briefs).toBeGreaterThan(m.price)
  })

  it("cadence, not competitors, is the expensive half of that step", () => {
    // The design principle behind the sheet: 3 -> 10 competitors costs $16.88, weekly -> daily
    // costs $37.93. If this ever inverts, the tier boundary is drawn in the wrong place.
    const m = tierLoadMultiple("mid", "entry")
    expect(m.briefs).toBeGreaterThan(m.entities)
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

  it("the floor is a subscriber-count problem, and it scales away", () => {
    // Replaces "top never reaches a healthy margin", which asserted a deleted $499 bundle. The
    // durable point is the one that shaped the pricing: at low subscriber counts the FIXED floor
    // dominates, and it thins out as subscribers arrive. That is why $99 costs velocity rather
    // than profit (§4 of the pricing doc).
    const entry = estimateTierCost("entry")
    const floorAt10 = fixedFloorPerSubscriberUsd(875, 10) as number
    const floorAt100 = fixedFloorPerSubscriberUsd(875, 100) as number
    expect(floorAt10).toBeGreaterThan(floorAt100)

    const marginAt = (floor: number) =>
      (entry.priceUsd - entry.totalVariableUsd - floor) / entry.priceUsd
    // Measured, not assumed: Starter still clears at 10 subscribers, but on ~16% instead of ~84%.
    // The floor does not sink it, it just eats almost all of the margin until subscribers arrive.
    expect(marginAt(floorAt10)).toBeGreaterThan(0)
    expect(marginAt(floorAt10)).toBeLessThan(0.25)
    expect(marginAt(floorAt100)).toBeGreaterThan(0.7)
    // 12 customers cover the whole floor (§4 of the pricing doc).
    expect(entry.priceUsd * 12).toBeGreaterThan(875)
  })
})
