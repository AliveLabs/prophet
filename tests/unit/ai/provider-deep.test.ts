// P5 — the deep pass (Opus + adaptive thinking) request shape. Guards the prod-400 risk:
// Opus 4.8 REJECTS temperature and budget_tokens; thinking must be adaptive + effort.

import { describe, it, expect, vi, afterEach } from "vitest"
import { claudeRaw, generateStructured, anthropicCallStats, DEEP_MODEL, type FallbackReason } from "@/lib/ai/provider"

type Captured = Record<string, unknown>

function mockFetch(): { body: () => Captured } {
  let captured: Captured = {}
  global.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
    captured = JSON.parse(init.body)
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }] }) } as unknown as Response
  }) as unknown as typeof fetch
  return { body: () => captured }
}

describe("provider deep pass (Opus + adaptive thinking)", () => {
  const realFetch = global.fetch
  const hadKey = process.env.ANTHROPIC_API_KEY
  afterEach(() => {
    vi.useRealTimers()
    global.fetch = realFetch
    if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = hadKey
    vi.restoreAllMocks()
  })

  it("thinking request uses the Opus model, adaptive thinking + effort, and NO temperature", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const f = mockFetch()
    await claudeRaw({ tier: "reasoning", prompt: "x", model: DEEP_MODEL, thinking: true, effort: "high" })
    const b = f.body()
    expect(b.model).toBe(DEEP_MODEL)
    expect(b.thinking).toEqual({ type: "adaptive" })
    expect(b.output_config).toEqual({ effort: "high" })
    expect(b.temperature).toBeUndefined() // Opus 4.8 400s if temperature is sent
    expect(b.max_tokens).toBe(32000) // deep pass gets headroom (thinking counts as output)
  })

  it("normal request keeps temperature, no thinking/effort", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const f = mockFetch()
    await claudeRaw({ tier: "reasoning", prompt: "x", temperature: 0.4 })
    const b = f.body()
    expect(b.thinking).toBeUndefined()
    expect(b.output_config).toBeUndefined()
    expect(b.temperature).toBe(0.4)
    expect(b.max_tokens).toBe(8192)
  })

  // P5 review finding A+B: a hung deep call must abort and degrade — NOT stall the brief, and
  // NOT be retried (each retry is an expensive Opus+thinking call that would just hang again).
  it("aborts a hung deep call after the timeout and does not retry it", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.useFakeTimers()
    const fetchMock = vi.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const e = new Error("aborted")
            e.name = "AbortError"
            reject(e)
          })
        }),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const p = claudeRaw({ tier: "reasoning", prompt: "x", model: DEEP_MODEL, thinking: true, effort: "high" })
    const assertion = expect(p).rejects.toThrow(/timed out/)
    // Deep ceiling raised 120s→240s (2026-07-07): convergence timed out on 4/6 briefs under the
    // 3 AM burst; the flagship needs the same headroom producers got in #97.
    await vi.advanceTimersByTimeAsync(240_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1) // hung deep call must NOT be retried
  })

  // 2026-07-04: the 16k→32k fix (PR #96) traded truncation for TIMEOUT — 7/9 producers aborted at
  // the 120s Opus-deep ceiling they'd inherited. Producers (Sonnet + thinking, NO opus model) get
  // their OWN ceiling. (2026-07-07: the deep ceiling was also raised to 240s, so the "pending at
  // 120s" probe still guards both paths against a regression to the old 120s default. 2026-07-08:
  // producer ceiling raised again, 240s→300s — guerrilla/local-demand/positioning genuinely needed
  // >240s of pure API time on some full-build dossiers; NOT contention, no rate pressure that morning.)
  it("gives producers (Sonnet + thinking) the full 300s ceiling, not the old 120s or 240s", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    vi.useFakeTimers()
    const fetchMock = vi.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const e = new Error("aborted")
            e.name = "AbortError"
            reject(e)
          })
        }),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const p = claudeRaw({ tier: "reasoning", prompt: "x", thinking: true, effort: "medium" }) // producer: no opus model
    const assertion = expect(p).rejects.toThrow(/timed out/)
    // At the Opus-deep ceiling (120s) a producer must NOT have aborted yet.
    await vi.advanceTimersByTimeAsync(120_000)
    const sentinel = Symbol("pending")
    const race = await Promise.race([p.then(() => "settled", () => "settled"), Promise.resolve(sentinel)])
    expect(race).toBe(sentinel) // still pending at 120s — proves it's not on the 120s ceiling
    // It aborts at its own 300s ceiling.
    await vi.advanceTimersByTimeAsync(180_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// 2026-07-03 regression: adaptive-thinking output that hits max_tokens used to slip through as
// empty text → null parse → SILENT deterministic fallback (hid a fleet-wide producer outage for
// ~2 weeks). claudeRaw must now FAIL LOUD, and generateStructured must classify it as "truncated".
describe("provider truncation guard (stop_reason=max_tokens)", () => {
  const realFetch = global.fetch
  const hadKey = process.env.ANTHROPIC_API_KEY
  afterEach(() => {
    global.fetch = realFetch
    if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = hadKey
    vi.restoreAllMocks()
  })

  function mockTruncated() {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "" }], stop_reason: "max_tokens", usage: { output_tokens: 32000 } }),
    })) as unknown as typeof fetch
  }

  it("throws a clear truncation error when the model stops at max_tokens", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    mockTruncated()
    await expect(claudeRaw({ tier: "reasoning", prompt: "x", label: "guerrilla-marketing" })).rejects.toThrow(/truncated at max_tokens/i)
  })

  it("does NOT throw on a normal stop (end_turn / absent stop_reason)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }),
    })) as unknown as typeof fetch
    await expect(claudeRaw({ tier: "reasoning", prompt: "x" })).resolves.toBe("{}")
  })

  it("generateStructured classifies truncation as 'truncated' and serves the fallback", async () => {
    let captured: FallbackReason | null = null
    const fallbackValue = [{ ok: true }]
    const truncatingTransport = async () => {
      throw new Error("Anthropic output truncated at max_tokens (out=32000, cap=32000)")
    }
    const result = await generateStructured<typeof fallbackValue>(
      { tier: "reasoning", prompt: "x", label: "guerrilla-marketing" },
      {
        transport: truncatingTransport,
        validate: (raw) => raw as typeof fallbackValue,
        fallback: () => fallbackValue,
        onFallback: (info) => { captured = info.reason },
      },
    )
    expect(result).toBe(fallbackValue)
    expect(captured).toBe("truncated")
  })

  it("generateStructured classifies unparseable output (valid call, failed validation) distinctly", async () => {
    let captured: FallbackReason | null = null
    const fallbackValue = [{ ok: true }]
    const result = await generateStructured<typeof fallbackValue>(
      { tier: "reasoning", prompt: "x", label: "positioning" },
      {
        transport: async () => ({ garbage: true }), // resolves, but validate rejects it
        validate: () => null,
        fallback: () => fallbackValue,
        onFallback: (info) => { captured = info.reason },
      },
    )
    expect(result).toBe(fallbackValue)
    expect(captured).toBe("unparseable")
  })
})

// Rate-limit counters feed the fleet-wide rateLimitedRate health signal (the leading indicator of the
// Anthropic rate ceiling). A 429 must increment both the request count and the rate-limited count.
describe("provider rate-limit counters (429/529)", () => {
  const realFetch = global.fetch
  const hadKey = process.env.ANTHROPIC_API_KEY
  afterEach(() => {
    global.fetch = realFetch
    if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = hadKey
    vi.restoreAllMocks()
  })

  it("counts a 429 as one request + one rate-limit (retries:0 → no backoff sleep)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const before = anthropicCallStats()
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: async () => "rate limited",
    })) as unknown as typeof fetch
    await expect(claudeRaw({ tier: "reasoning", prompt: "x", label: "marketing" }, { retries: 0 })).rejects.toThrow(/429/)
    const after = anthropicCallStats()
    expect(after.rateLimited - before.rateLimited).toBe(1)
    expect(after.requests - before.requests).toBe(1)
  })

  it("a clean 200 increments requests but NOT rate-limited", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    const before = anthropicCallStats()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }] }) })) as unknown as typeof fetch
    await claudeRaw({ tier: "reasoning", prompt: "x" })
    const after = anthropicCallStats()
    expect(after.requests - before.requests).toBe(1)
    expect(after.rateLimited - before.rateLimited).toBe(0)
  })
})
