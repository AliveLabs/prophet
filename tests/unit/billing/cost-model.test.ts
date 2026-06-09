import { describe, it, expect } from "vitest"
import { estimateClientCost, COST_KNOBS } from "@/lib/billing/cost-model"

// Doubles as a living estimate: run `npx vitest run tests/unit/billing/cost-model.test.ts`
// to print the per-client cost breakdown across all data sources, to re-verify pricing.
describe("estimateClientCost — all-sources cost vs pricing tiers", () => {
  const tiers = [
    { name: "Tier 1 ($149)", competitors: 3, platforms: 1, cadence: "weekly" as const, monthlyPriceUsd: 149 },
    { name: "Tier 2 ($299)", competitors: 5, platforms: 3, cadence: "weekly" as const, monthlyPriceUsd: 299 },
    { name: "Tier 3 ($499)", competitors: 10, platforms: 3, cadence: "daily" as const, monthlyPriceUsd: 499 },
  ]

  it("prints a per-source breakdown + COGS for each tier", () => {
    for (const t of tiers) {
      const e = estimateClientCost(t)
      console.log(`\n=== ${t.name} (${t.competitors} comps, ${t.platforms} networks, ${t.cadence}) ===`)
      console.log(`  total $${e.totalUsd}/mo · per-competitor $${e.perCompetitorUsd} · COGS ${e.cogsPct}% · margin ${e.marginPct}%`)
      console.log(`  by source:`, JSON.stringify(e.bySourceUsd))
      console.log(`  ${e.notes.join("; ")}`)
      expect(e.totalUsd).toBeGreaterThan(0)
      expect(Object.keys(e.bySourceUsd)).toContain("data365")
      expect(e.cogsPct).not.toBeNull()
    }
  })

  it("posts-per-pull is a real Data365 cost lever", () => {
    const base = { competitors: 5, platforms: 3, cadence: "weekly" as const }
    const cheap = estimateClientCost({ ...base, postsPerPull: 5 })
    const rich = estimateClientCost({ ...base, postsPerPull: 30 })
    expect(rich.bySourceUsd.data365).toBeGreaterThan(cheap.bySourceUsd.data365)
  })

  it("dormant accounts cut Data365 credit consumption", () => {
    const base = { competitors: 5, platforms: 3, cadence: "weekly" as const }
    const mostlyActive = estimateClientCost({ ...base, dormantFraction: 0.1 })
    const mostlyDormant = estimateClientCost({ ...base, dormantFraction: 0.9 })
    expect(mostlyDormant.data365CreditsPerMonth).toBeLessThan(mostlyActive.data365CreditsPerMonth)
  })

  it("exposes posts-per-pull as the central adjustable knob", () => {
    expect(COST_KNOBS.data365PostsPerPull).toBeGreaterThan(0)
  })
})
