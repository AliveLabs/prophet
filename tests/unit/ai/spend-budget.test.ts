// ---------------------------------------------------------------------------
// Per-brief spend ceiling (step 2). The engine previously had no dollar guard at all.
//
// The properties worth locking down are the safety ones: with no ceiling configured the behaviour
// must be byte-identical to before, the guard must DEGRADE rather than abort (aborting lands in the
// deterministic-fallback path, the failure mode this codebase has twice been bitten by), and a
// crossing must never be silent. The AsyncLocalStorage scoping matters because Fluid co-locates
// builds: one expensive location must not degrade an unrelated location in the same process.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, afterEach } from "vitest"
import {
  currentSpendBudget,
  effortForNextCall,
  oneNotchCheaper,
  runWithSpendBudget,
  PER_BRIEF_CEILING_USD,
} from "@/lib/ai/spend-budget"
import { deltaTokensByModel, estimateAnthropicCostUsd, type ModelTokenTotals } from "@/lib/ai/pricing"

const tok = (o: Partial<ModelTokenTotals> = {}): ModelTokenTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  ...o,
})

afterEach(() => vi.restoreAllMocks())

describe("default posture", () => {
  it("ships DISABLED — no ceiling unless one is deliberately configured", () => {
    // We have no observed-spend baseline yet. A guessed ceiling silently degrades good briefs, so
    // the mechanism ships inert and `/admin/health` figures set the number later.
    if (!process.env.ANTHROPIC_PER_BRIEF_CEILING_USD) {
      expect(PER_BRIEF_CEILING_USD).toBeNull()
    }
  })

  it("a null ceiling opens no budget context at all", async () => {
    const seen = await runWithSpendBudget(null, {}, async () => currentSpendBudget())
    expect(seen).toBeUndefined()
  })

  it("outside a budget, requested effort passes through untouched", () => {
    expect(effortForNextCall("high", 999_999)).toBe("high")
    expect(effortForNextCall("medium", 999_999)).toBe("medium")
  })
})

describe("oneNotchCheaper", () => {
  it("steps down one level and floors at low", () => {
    expect(oneNotchCheaper("high")).toBe("medium")
    expect(oneNotchCheaper("medium")).toBe("low")
    expect(oneNotchCheaper("low")).toBe("low")
  })
})

describe("under a ceiling", () => {
  it("leaves effort alone while under budget, and tracks peak spend", async () => {
    await runWithSpendBudget(1.0, {}, async () => {
      expect(effortForNextCall("high", 0.25)).toBe("high")
      expect(effortForNextCall("high", 0.5)).toBe("high")
      const b = currentSpendBudget()!
      expect(b.degradedCalls).toBe(0)
      expect(b.peakSpendUsd).toBeCloseTo(0.5)
    })
  })

  it("degrades one notch once spend reaches the ceiling, and never aborts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await runWithSpendBudget(1.0, {}, async () => {
      expect(effortForNextCall("high", 1.0)).toBe("medium") // at the ceiling counts as crossed
      expect(effortForNextCall("medium", 2.0)).toBe("low")
      expect(effortForNextCall("low", 5.0)).toBe("low") // floors, still returns a usable effort
      expect(currentSpendBudget()!.degradedCalls).toBe(3)
    })
    // Never silent: a cost guard nobody can see is indistinguishable from no cost guard.
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls[0][0]).toContain("ceiling crossed")
  })

  it("names the offending call in the log when a label is supplied", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await runWithSpendBudget(0.5, {}, async () => effortForNextCall("high", 0.9, "guerrilla-marketing"))
    expect(warn.mock.calls[0][0]).toContain("guerrilla-marketing")
  })
})

describe("build isolation (Fluid co-locates builds on one instance)", () => {
  it("keeps concurrent budgets independent — one build cannot degrade another", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const expensive = runWithSpendBudget(0.1, {}, async () => {
      await new Promise((r) => setTimeout(r, 5))
      effortForNextCall("high", 10.0) // way over its own ceiling
      return currentSpendBudget()!.degradedCalls
    })
    const cheap = runWithSpendBudget(100.0, {}, async () => {
      await new Promise((r) => setTimeout(r, 5))
      const effort = effortForNextCall("high", 1.0) // comfortably under ITS ceiling
      return { effort, degraded: currentSpendBudget()!.degradedCalls }
    })
    const [a, b] = await Promise.all([expensive, cheap])
    expect(a).toBe(1)
    expect(b).toEqual({ effort: "high", degraded: 0 })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe("deltaTokensByModel", () => {
  it("returns this build's usage out of process-lifetime counters", () => {
    const start = { "claude-sonnet-4-6": tok({ inputTokens: 1000, outputTokens: 500 }) }
    const end = { "claude-sonnet-4-6": tok({ inputTokens: 1600, outputTokens: 900 }) }
    expect(deltaTokensByModel(start, end)["claude-sonnet-4-6"]).toEqual(
      tok({ inputTokens: 600, outputTokens: 400 }),
    )
  })

  it("treats a model absent from the start snapshot as all-new", () => {
    const end = { "claude-opus-4-8": tok({ inputTokens: 100, outputTokens: 50 }) }
    expect(deltaTokensByModel({}, end)["claude-opus-4-8"]).toEqual(tok({ inputTokens: 100, outputTokens: 50 }))
  })

  it("omits models that did not move, so an idle model is not reported as $0 usage", () => {
    const same = { "claude-sonnet-4-6": tok({ inputTokens: 10 }) }
    expect(deltaTokensByModel(same, same)).toEqual({})
  })

  it("prices a delta the same way /admin/health does", () => {
    // 1M Opus input + 1M output = $5 + $25.
    const usd = estimateAnthropicCostUsd({
      "claude-opus-4-8": tok({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    })
    expect(usd).toBeCloseTo(30, 6)
  })
})
