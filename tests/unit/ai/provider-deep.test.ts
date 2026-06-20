// P5 — the deep pass (Opus + adaptive thinking) request shape. Guards the prod-400 risk:
// Opus 4.8 REJECTS temperature and budget_tokens; thinking must be adaptive + effort.

import { describe, it, expect, vi, afterEach } from "vitest"
import { claudeRaw, DEEP_MODEL } from "@/lib/ai/provider"

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
    await vi.advanceTimersByTimeAsync(120_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1) // hung deep call must NOT be retried
  })
})
