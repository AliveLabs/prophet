// ---------------------------------------------------------------------------
// ALT-544: the two things that made a model swap unsafe.
//
// 1. The non-thinking Anthropic branch sent `temperature`. Opus 4.7+, Sonnet 5, Opus 5, Fable 5 and
//    Mythos 5 all REMOVED sampling params and 400 on them. On this codebase's non-thinking path a
//    400 degrades the call to a deterministic fallback, and a producer fallback is indistinguishable
//    from a real generation without reading skillHealth. Flipping ANTHROPIC_MODEL would have done
//    that to eight call sites at once, including safety-review and the eval judge.
// 2. `pricing.ts` mispriced the 5 family, so the sweep's own cost comparison would have been wrong.
//
// The polarity of the temperature gate is the load-bearing property: an UNKNOWN model must omit
// temperature. Omitting is a soft wrong (provider's sampling default); sending is a hard one (400).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest"
import { acceptsTemperature } from "@/lib/ai/provider"
import { estimateAnthropicCostUsd, rateFor, type ModelTokenTotals } from "@/lib/ai/pricing"

const tok = (o: Partial<ModelTokenTotals> = {}): ModelTokenTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  ...o,
})

describe("acceptsTemperature", () => {
  it("says yes for the models we run today, so nothing changes now", () => {
    expect(acceptsTemperature("claude-sonnet-4-6")).toBe(true) // current ANTHROPIC_MODEL
    expect(acceptsTemperature("claude-haiku-4-5")).toBe(true)
    expect(acceptsTemperature("claude-sonnet-4-5")).toBe(true)
    expect(acceptsTemperature("claude-opus-4-6")).toBe(true)
  })

  it("says no for every model that removed sampling params", () => {
    for (const m of [
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-opus-4-8", // current DEEP_MODEL — only ever used with thinking, but must still be no
      "claude-opus-4-7",
      "claude-fable-5",
      "claude-mythos-5",
    ]) {
      expect(acceptsTemperature(m), m).toBe(false)
    }
  })

  it("defaults an UNKNOWN model to NO — the safe direction", () => {
    // An allowlist, not a denylist. A future model id we have never seen must not be able to
    // trigger a fleet-wide 400 just because nobody updated a regex.
    expect(acceptsTemperature("claude-something-7")).toBe(false)
    expect(acceptsTemperature("")).toBe(false)
  })
})

describe("pricing: the 5 family", () => {
  it("prices Opus 5 at the Opus rate (unchanged from 4.8)", () => {
    expect(rateFor("claude-opus-5")).toEqual({ input: 5, output: 25 })
  })

  it("prices Fable and Mythos above Opus instead of silently defaulting to Sonnet-tier", () => {
    // This was the actual bug: neither matched any family regex, so both fell through to $3/$15.
    expect(rateFor("claude-fable-5")).toEqual({ input: 10, output: 50 })
    expect(rateFor("claude-mythos-5")).toEqual({ input: 10, output: 50 })
  })

  it("honours Sonnet 5 introductory pricing inside the window and list price after", () => {
    expect(rateFor("claude-sonnet-5", "2026-08-15")).toEqual({ input: 2, output: 10 })
    expect(rateFor("claude-sonnet-5", "2026-08-31")).toEqual({ input: 2, output: 10 }) // inclusive
    expect(rateFor("claude-sonnet-5", "2026-09-01")).toEqual({ input: 3, output: 15 })
  })

  it("keeps Sonnet 4.6 on list price regardless of date (the intro window is Sonnet 5 only)", () => {
    expect(rateFor("claude-sonnet-4-6", "2026-08-15")).toEqual({ input: 3, output: 15 })
  })

  it("still falls back to Sonnet-tier for a genuinely unknown id rather than $0", () => {
    // A $0 estimate would read as "this build was free" and quietly break the spend ceiling.
    expect(rateFor("some-new-model")).toEqual({ input: 3, output: 15 })
  })

  it("specific ids win over family regexes (order dependence is load-bearing)", () => {
    // "claude-sonnet-5" also matches /sonnet/i; the specific row must be found first.
    expect(rateFor("claude-sonnet-5", "2026-09-01")).toEqual({ input: 3, output: 15 })
    expect(rateFor("claude-fable-5")).not.toEqual({ input: 3, output: 15 })
  })
})

describe("estimateAnthropicCostUsd", () => {
  it("threads asOf through, so a sweep during the intro window is not over-estimated by a third", () => {
    const usage = { "claude-sonnet-5": tok({ inputTokens: 1_000_000, outputTokens: 1_000_000 }) }
    expect(estimateAnthropicCostUsd(usage, "2026-08-15")).toBeCloseTo(12, 6) // 2 + 10 intro
    expect(estimateAnthropicCostUsd(usage, "2026-09-01")).toBeCloseTo(18, 6) // 3 + 15 list
  })

  it("prices cache reads at 0.1x input and 1h-TTL writes at 2x", () => {
    // The engine's unit economics live here: reads are the win, writes are the premium.
    const reads = estimateAnthropicCostUsd({ "claude-opus-5": tok({ cacheReadTokens: 1_000_000 }) })
    const writes = estimateAnthropicCostUsd({ "claude-opus-5": tok({ cacheWriteTokens: 1_000_000 }) })
    expect(reads).toBeCloseTo(0.5, 6) // 5 * 0.1
    expect(writes).toBeCloseTo(10, 6) // 5 * 2
  })
})
