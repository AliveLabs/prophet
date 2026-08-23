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

import { describe, expect, it, vi, afterEach } from "vitest"
import { acceptsTemperature, claudeRaw, ANTHROPIC_MODEL, DEEP_MODEL, FAST_MODEL } from "@/lib/ai/provider"
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
    expect(acceptsTemperature("claude-sonnet-4-6")).toBe(true) // a 4.x model, still on the allowlist
    expect(acceptsTemperature("claude-haiku-4-5")).toBe(true)
    expect(acceptsTemperature("claude-sonnet-4-5")).toBe(true)
    expect(acceptsTemperature("claude-opus-4-6")).toBe(true)
  })

  it("says no for every model that removed sampling params", () => {
    for (const m of [
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-opus-4-8", // only ever used with thinking, but must still be no
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

// Request-shape level (not just the pure acceptsTemperature function): a non-thinking call on a
// 5-family model must never put `temperature` on the wire, and a non-thinking call on a 4.x model
// must keep sending it exactly as before (behavior on today's models stays byte-identical).
describe("claudeRaw request shape — temperature by model generation", () => {
  const realFetch = global.fetch
  const hadKey = process.env.ANTHROPIC_API_KEY
  afterEach(() => {
    global.fetch = realFetch
    if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = hadKey
    vi.restoreAllMocks()
  })

  function mockFetch(): { body: () => Record<string, unknown> } {
    let captured: Record<string, unknown> = {}
    global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      captured = JSON.parse(init.body)
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }] }) } as unknown as Response
    }) as unknown as typeof fetch
    return { body: () => captured }
  }

  it("strips temperature for a non-thinking call on a 5-family model", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const f = mockFetch()
    await claudeRaw({ tier: "reasoning", prompt: "x", model: "claude-sonnet-5", temperature: 0.4 })
    expect(f.body().temperature).toBeUndefined()
  })

  it("preserves temperature for a non-thinking call on a 4.x model (today's behavior, unchanged)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const f = mockFetch()
    await claudeRaw({ tier: "reasoning", prompt: "x", model: "claude-sonnet-4-6", temperature: 0.4 })
    expect(f.body().temperature).toBe(0.4)
  })

  it("strips temperature whenever thinking is enabled, regardless of model generation", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const f = mockFetch()
    // claude-sonnet-4-6 accepts temperature on its OWN non-thinking branch (see the test above) —
    // but thinking and temperature are mutually exclusive on every model, 4.x included.
    await claudeRaw({ tier: "reasoning", prompt: "x", model: "claude-sonnet-4-6", thinking: true, effort: "medium", temperature: 0.4 })
    const b = f.body()
    expect(b.temperature).toBeUndefined()
    expect(b.thinking).toEqual({ type: "adaptive" })
    expect(b.output_config).toEqual({ effort: "medium" })
  })
})

// ALT-613. The SECOND thing that made a model swap unsafe, and the one ALT-544 missed.
//
// Omitting `thinking` is not neutral. On Sonnet 4.6 / Opus 4.8 an absent field means no thinking;
// on Sonnet 5 and Opus 5 thinking is ON BY DEFAULT. So an omitted field silently enables adaptive
// thinking on every non-thinking call site the moment ANTHROPIC_MODEL points at a 5-family id,
// against max_tokens ceilings sized for no thinking — the 2026-06 truncation outage mechanism,
// landing on safety-review and on the eval judge itself.
//
// The load-bearing property: the non-thinking branch must send an EXPLICIT disable, on every model.
describe("claudeRaw request shape — thinking is always explicit", () => {
  const realFetch = global.fetch
  const hadKey = process.env.ANTHROPIC_API_KEY
  afterEach(() => {
    global.fetch = realFetch
    if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = hadKey
    vi.restoreAllMocks()
  })

  function mockFetch(): { body: () => Record<string, unknown> } {
    let captured: Record<string, unknown> = {}
    global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
      captured = JSON.parse(init.body)
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }] }) } as unknown as Response
    }) as unknown as typeof fetch
    return { body: () => captured }
  }

  it("NEVER omits the thinking field on a non-thinking call, on any model", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    for (const model of ["claude-sonnet-4-6", "claude-sonnet-5", "claude-opus-4-8", "claude-opus-5", "claude-haiku-4-5"]) {
      const f = mockFetch()
      await claudeRaw({ tier: "reasoning", prompt: "x", model })
      expect(f.body().thinking, model).toEqual({ type: "disabled" })
    }
  })

  it("still sends temperature alongside the explicit disable on models that accept it", async () => {
    // Verified live: `thinking:{type:"disabled"}` + `temperature` returns 200 on Sonnet 4.6 and
    // Haiku 4.5. Today's behaviour is otherwise unchanged — this is additive.
    process.env.ANTHROPIC_API_KEY = "test-key"
    const f = mockFetch()
    await claudeRaw({ tier: "reasoning", prompt: "x", model: "claude-sonnet-4-6", temperature: 0.1 })
    expect(f.body().thinking).toEqual({ type: "disabled" })
    expect(f.body().temperature).toBe(0.1)
  })

  it("sends the explicit disable WITHOUT temperature on a 5-family model", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const f = mockFetch()
    await claudeRaw({ tier: "reasoning", prompt: "x", model: "claude-sonnet-5", temperature: 0.1 })
    expect(f.body().thinking).toEqual({ type: "disabled" })
    expect(f.body().temperature).toBeUndefined()
  })

  it("never sends output_config on the disabled branch — Opus 5 400s on disabled + xhigh/max", async () => {
    // The disabled branch inherits the provider's default effort (`high`), which Opus 5 accepts.
    // If ALT-614 ever starts sending effort here it needs a per-model guard first.
    process.env.ANTHROPIC_API_KEY = "test-key"
    const f = mockFetch()
    await claudeRaw({ tier: "reasoning", prompt: "x", model: "claude-opus-5", effort: "high" })
    expect(f.body().thinking).toEqual({ type: "disabled" })
    expect(f.body().output_config).toBeUndefined()
  })

  it("keeps adaptive thinking on the thinking path (no accidental disable)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const f = mockFetch()
    await claudeRaw({ tier: "reasoning", prompt: "x", model: "claude-sonnet-5", thinking: true, effort: "medium" })
    expect(f.body().thinking).toEqual({ type: "adaptive" })
    expect(f.body().output_config).toEqual({ effort: "medium" })
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

  // 2026-08-10 Anthropic announcement (verified): Sonnet 5's $2/$10 per MTok is the STANDING
  // price. The previously-planned 2026-09-01 step-up to $3/$15 was cancelled — this is not an
  // expiring "intro" rate, so there is no date at which the rate changes.
  it("prices Sonnet 5 at its standing $2/$10 rate", () => {
    expect(rateFor("claude-sonnet-5")).toEqual({ input: 2, output: 10 })
  })

  it("keeps Sonnet 4.6 on its own list price, distinct from Sonnet 5's", () => {
    expect(rateFor("claude-sonnet-4-6")).toEqual({ input: 3, output: 15 })
  })

  it("still falls back to Sonnet-tier for a genuinely unknown id rather than $0", () => {
    // A $0 estimate would read as "this build was free" and quietly break the spend ceiling.
    expect(rateFor("some-new-model")).toEqual({ input: 3, output: 15 })
  })

  it("specific ids win over family regexes (order dependence is load-bearing)", () => {
    // "claude-sonnet-5" also matches /sonnet/i; the specific row must be found first.
    expect(rateFor("claude-sonnet-5")).not.toEqual({ input: 3, output: 15 })
    expect(rateFor("claude-fable-5")).not.toEqual({ input: 3, output: 15 })
  })
})

describe("estimateAnthropicCostUsd", () => {
  it("prices Sonnet 5 usage at its standing rate — no intro-window math to thread through", () => {
    const usage = { "claude-sonnet-5": tok({ inputTokens: 1_000_000, outputTokens: 1_000_000 }) }
    expect(estimateAnthropicCostUsd(usage)).toBeCloseTo(12, 6) // 2 + 10
  })

  it("prices cache reads at 0.1x input and 1h-TTL writes at 2x", () => {
    // The engine's unit economics live here: reads are the win, writes are the premium.
    const reads = estimateAnthropicCostUsd({ "claude-opus-5": tok({ cacheReadTokens: 1_000_000 }) })
    const writes = estimateAnthropicCostUsd({ "claude-opus-5": tok({ cacheWriteTokens: 1_000_000 }) })
    expect(reads).toBeCloseTo(0.5, 6) // 5 * 0.1
    expect(writes).toBeCloseTo(10, 6) // 5 * 2
  })
})

// ── ALT-461: the code default must not drift behind production ───────────────────────────────
//
// Production has run ANTHROPIC_MODEL=claude-sonnet-5 and ANTHROPIC_DEEP_MODEL=claude-opus-5 since
// the 5-family swap. The code defaults stayed at claude-sonnet-4-6 and claude-opus-4-8, so every
// environment WITHOUT those env vars (preview, local dev, CI) ran a model generation prod had
// stopped using.
//
// That is not cosmetic. `acceptsTemperature` is an allowlist: sonnet-4-6 is on it and sonnet-5 is
// not, so non-prod was putting `temperature` on requests where prod omits it. The one environment
// you would reach for to reproduce a model-shaped bug was the one not running the model.
//
// These assertions are about the DEFAULT, not about any particular id, so they keep holding as the
// family moves on. What they refuse is a default that has drifted into a generation whose
// temperature behaviour differs from the one we actually run.
describe("the default models agree with what production runs", () => {
  it("the base and deep defaults both omit temperature, like prod", () => {
    // The property that matters. If a future default lands back on an allowlisted 4.x model, the
    // wire shape diverges from prod again and this fails.
    expect(acceptsTemperature(ANTHROPIC_MODEL), ANTHROPIC_MODEL).toBe(false)
    expect(acceptsTemperature(DEEP_MODEL), DEEP_MODEL).toBe(false)
  })

  it("the fast model DOES accept temperature, which is deliberate and not drift", () => {
    // Haiku 4.5 is the current haiku and is on the allowlist on purpose. Prod sets no override for
    // it, so the default IS what prod runs. Asserted so nobody "fixes" it to match the other two.
    expect(acceptsTemperature(FAST_MODEL), FAST_MODEL).toBe(true)
  })

  it("every default is priced, or the cost telemetry silently reads zero", () => {
    // pricing.ts matches by regex and ALT-544 records that the family patterns alone mispriced the
    // 5 family. A default with no matching rate would make $/brief quietly wrong rather than error.
    for (const m of [ANTHROPIC_MODEL, DEEP_MODEL, FAST_MODEL]) {
      const rate = rateFor(m)
      expect(rate, m).toBeTruthy()
      expect(rate!.input, m).toBeGreaterThan(0)
      expect(rate!.output, m).toBeGreaterThan(0)
    }
  })

  it("the base and deep defaults are different models", () => {
    // The deep pass exists to be a stronger model than the producers. Collapsing them would be an
    // invisible quality regression, since both paths would still work.
    expect(ANTHROPIC_MODEL).not.toBe(DEEP_MODEL)
  })
})
