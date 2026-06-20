// P2 — scoring core. Locks in the continuous combined score that replaces the old
// KIND_RANK×10 + CONF_RANK ladder: one global pool, impact + confidence + importance
// weighted into a base, times a MODEST category prior (a bias, never a gate).

import { describe, it, expect } from "vitest"
import {
  weightedBase,
  computeBaseScore,
  computeCombinedScore,
  rankPlays,
  CATEGORY_PRIORS,
  IMPACT_DEFAULT,
  IMPACT_SCORE,
  type ScoreInput,
} from "@/lib/skills/scoring-config"

describe("scoring-config — base score", () => {
  it("weights the three factors 0.40/0.35/0.25 (the worked example holds)", () => {
    // The plan's worked example: ops impact 50 / confidence 92 / importance 50 → base ≈ 65.
    expect(weightedBase({ impact: 50, confidence: 92, importance: 50 })).toBeCloseTo(64.7, 5)
    // …× the operations prior 0.85 = 55, which must beat a marketing base 50 × 1.0 = 50.
    expect(Math.round(64.7 * CATEGORY_PRIORS.operations)).toBe(55)
    expect(55).toBeGreaterThan(Math.round(50 * CATEGORY_PRIORS.marketing))
  })

  it("maps confidence/impact enums to 0-100 and defaults importance to neutral", () => {
    // high confidence (100) + medium impact (60) + neutral importance (50)
    expect(computeBaseScore({ confidence: "high", impact: "medium", category: "demand" })).toBeCloseTo(71.5, 5)
  })

  it("treats a play with NO leverage as medium impact (not buried at low)", () => {
    const noLeverage = computeBaseScore({ confidence: "high", category: "demand" })
    const explicitMedium = computeBaseScore({ confidence: "high", impact: "medium", category: "demand" })
    expect(noLeverage).toBe(explicitMedium)
    expect(IMPACT_DEFAULT).toBe(IMPACT_SCORE.medium)
  })

  it("importance is neutral by default and lifts the base when supplied", () => {
    const neutral = computeBaseScore({ confidence: "high", impact: "medium", category: "demand" })
    const explicit50 = computeBaseScore({ confidence: "high", impact: "medium", importance: 50, category: "demand" })
    const high = computeBaseScore({ confidence: "high", impact: "medium", importance: 100, category: "demand" })
    expect(neutral).toBe(explicit50)
    expect(high).toBeGreaterThan(neutral)
  })
})

describe("scoring-config — combined score (base × category prior)", () => {
  it("best and worst realistic cases", () => {
    // best: high conf, high impact, neutral demand prior → round(87.5 × 1.0)
    expect(computeCombinedScore({ confidence: "high", impact: "high", category: "demand" })).toBe(88)
    // worst: directional conf, low impact, operations prior → round(33 × 0.85)
    expect(computeCombinedScore({ confidence: "directional", impact: "low", category: "operations" })).toBe(28)
  })

  it("a STRONG operations play beats a WEAK marketing play (the core property)", () => {
    const strongOps = computeCombinedScore({ confidence: "high", impact: "high", category: "operations" })
    const weakMarketing = computeCombinedScore({ confidence: "directional", impact: "low", category: "marketing" })
    expect(strongOps).toBe(74) // round(87.5 × 0.85)
    expect(weakMarketing).toBe(33) // round(33 × 1.0)
    expect(strongOps).toBeGreaterThan(weakMarketing)
  })

  it("kills the old kind-ladder bug: high-confidence positioning now beats low-confidence demand", () => {
    // Under synthesis.ts:41-47 a low-confidence "capitalize"/demand always beat a
    // high-confidence "positioning" because impact was ignored and kind was a hard gate.
    const hiPositioning = computeCombinedScore({ confidence: "high", impact: "high", category: "positioning" })
    const loDemand = computeCombinedScore({ confidence: "directional", impact: "medium", category: "demand" })
    expect(hiPositioning).toBe(83) // round(87.5 × 0.95)
    expect(loDemand).toBe(47) // round(47 × 1.0)
    expect(hiPositioning).toBeGreaterThan(loDemand)
  })
})

describe("scoring-config — ranking & tie-breaking", () => {
  type Item = { id: string; input: ScoreInput }
  const rank = (items: Item[]) => rankPlays(items, (i) => i.input).ranked.map((r) => r.item.id)

  it("orders the pool best-first by combined score", () => {
    const items: Item[] = [
      { id: "weak", input: { confidence: "directional", impact: "low", category: "marketing" } },
      { id: "strong", input: { confidence: "high", impact: "high", category: "operations" } },
      { id: "mid", input: { confidence: "medium", impact: "medium", category: "demand" } },
    ]
    expect(rank(items)).toEqual(["strong", "mid", "weak"])
  })

  it("breaks ties by confidence, regardless of input order", () => {
    // Both score 62 (importance dialed to make the bases equal); A has higher confidence.
    const a: Item = { id: "a", input: { confidence: "high", impact: "medium", importance: 10, category: "demand" } }
    const b: Item = { id: "b", input: { confidence: "medium", impact: "medium", importance: 59, category: "demand" } }
    expect(computeCombinedScore(a.input)).toBe(computeCombinedScore(b.input))
    expect(rank([b, a])).toEqual(["a", "b"]) // higher confidence wins the tie
  })

  it("is stable: fully-equal items keep their input order", () => {
    const same: ScoreInput = { confidence: "high", impact: "high", importance: 50, category: "demand" }
    const items: Item[] = [
      { id: "first", input: same },
      { id: "second", input: same },
      { id: "third", input: same },
    ]
    expect(rank(items)).toEqual(["first", "second", "third"])
    expect(rank([...items].reverse())).toEqual(["third", "second", "first"])
  })
})

describe("scoring-config — prior-flip instrumentation", () => {
  type Item = { id: string; input: ScoreInput }

  it("reports priorFlipped=true when a prior reorders the pool vs the base alone", () => {
    // ops base 65 > mktg base 60, but ops×0.85=55 < mktg×1.0=60 → the prior flips them.
    const ops: Item = { id: "ops", input: { confidence: "directional", impact: "high", importance: 58, category: "operations" } }
    const mktg: Item = { id: "mktg", input: { confidence: "medium", impact: "medium", importance: 53, category: "marketing" } }
    expect(computeBaseScore(ops.input)).toBeGreaterThan(computeBaseScore(mktg.input))
    const { ranked, priorFlipped } = rankPlays([ops, mktg], (i) => i.input)
    expect(priorFlipped).toBe(true)
    expect(ranked.map((r) => r.item.id)).toEqual(["mktg", "ops"])
  })

  it("reports priorFlipped=false when every play shares a category (uniform prior)", () => {
    const items: Item[] = [
      { id: "hi", input: { confidence: "high", impact: "high", category: "demand" } },
      { id: "lo", input: { confidence: "directional", impact: "low", category: "demand" } },
    ]
    expect(rankPlays(items, (i) => i.input).priorFlipped).toBe(false)
  })
})
