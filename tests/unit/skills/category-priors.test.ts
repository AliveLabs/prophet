import { describe, it, expect } from "vitest"
import { rankPlays } from "@/lib/skills/scoring-config"
import {
  clampPrior,
  sanitizeCategoryPriors,
  diffFromDefaults,
  resolveCategoryPriors,
  DEFAULT_CATEGORY_PRIORS,
  PRIOR_MIN,
  PRIOR_MAX,
} from "@/lib/skills/category-priors"
import type { ScoreInput } from "@/lib/skills/scoring-config"

describe("clampPrior", () => {
  it("clamps to [0.5, 1.5]", () => {
    expect(clampPrior(2)).toBe(PRIOR_MAX)
    expect(clampPrior(0)).toBe(PRIOR_MIN)
    expect(clampPrior(1.2)).toBe(1.2)
  })
})

describe("sanitizeCategoryPriors", () => {
  it("drops unknown keys + non-finite, clamps the rest", () => {
    const out = sanitizeCategoryPriors({ marketing: 1.4, operations: 9, bogus: 1.1, demand: "x", menu: NaN })
    expect(out).toEqual({ marketing: 1.4, operations: PRIOR_MAX })
  })
  it("non-object → empty", () => {
    expect(sanitizeCategoryPriors(null)).toEqual({})
    expect(sanitizeCategoryPriors("nope")).toEqual({})
  })
})

describe("diffFromDefaults", () => {
  it("keeps only categories moved off their global default (so untouched ones keep following globals)", () => {
    const out = diffFromDefaults({ demand: 1.0, operations: 1.3, marketing: 1.0 })
    // demand/marketing equal default (1.0) → dropped; operations differs (default 0.85) → kept
    expect(out).toEqual({ operations: 1.3 })
  })
})

describe("resolveCategoryPriors", () => {
  it("merges an override over the global defaults", () => {
    const eff = resolveCategoryPriors({ operations: 1.5 })
    expect(eff.operations).toBe(1.5)
    expect(eff.marketing).toBe(DEFAULT_CATEGORY_PRIORS.marketing)
    expect(eff.reputation).toBe(DEFAULT_CATEGORY_PRIORS.reputation)
  })
  it("null override → the global defaults unchanged", () => {
    expect(resolveCategoryPriors(null)).toEqual(DEFAULT_CATEGORY_PRIORS)
  })
})

describe("rerank honors a per-operator override", () => {
  const marketing: ScoreInput = { category: "marketing", confidence: "high", impact: "high" }
  const operations: ScoreInput = { category: "operations", confidence: "high", impact: "medium" }
  const items = [marketing, operations]
  const toInput = (x: ScoreInput) => x

  it("with global priors, marketing leads (higher base, neutral prior beats ops' 0.85)", () => {
    const { ranked } = rankPlays(items, toInput)
    expect(ranked[0].item.category).toBe("marketing")
  })

  it("operator boosts operations to 1.5 → operations now leads (and the prior flips the order)", () => {
    const priors = resolveCategoryPriors({ operations: 1.5 })
    const { ranked, priorFlipped } = rankPlays(items, toInput, priors)
    expect(ranked[0].item.category).toBe("operations")
    expect(priorFlipped).toBe(true)
  })
})
