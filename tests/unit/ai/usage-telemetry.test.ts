// Cost telemetry (2026-07-16, Phase 0): per-call token usage must reach BOTH surfaces —
// the process counters (anthropicCallStats().tokensByModel → Brief.providerStats delta) and
// the per-call onUsage callback (→ SkillResult.tokens → skillHealth). Also guards the pricing
// estimate math the /admin/health page renders.

import { describe, it, expect, vi, afterEach } from "vitest"
import { claudeRaw, anthropicCallStats, DEEP_MODEL } from "@/lib/ai/provider"
import { estimateAnthropicCostUsd } from "@/lib/ai/pricing"
import type { TokenUsage } from "@/lib/ai/provider"

const USAGE_RESPONSE = {
  content: [{ type: "text", text: "{}" }],
  usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 200, cache_read_input_tokens: 4000 },
}

function mockFetchWith(payload: unknown): void {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => payload }) as unknown as Response) as unknown as typeof fetch
}

describe("provider usage telemetry", () => {
  const realFetch = global.fetch
  const hadKey = process.env.ANTHROPIC_API_KEY
  afterEach(() => {
    global.fetch = realFetch
    if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = hadKey
    vi.restoreAllMocks()
  })

  it("reports usage to onUsage and accumulates the per-model counters", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    mockFetchWith(USAGE_RESPONSE)
    const before = anthropicCallStats()
    const seen: TokenUsage[] = []
    await claudeRaw({ tier: "reasoning", prompt: "x", model: DEEP_MODEL, thinking: true, onUsage: (u) => seen.push(u) })
    // callback carries the parsed usage + the model that ran
    expect(seen).toEqual([
      { model: DEEP_MODEL, inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 200, cacheReadTokens: 4000 },
    ])
    // process counters advanced by exactly this call (delta vs the snapshot — counters are process-wide)
    const after = anthropicCallStats()
    const beforeT = before.tokensByModel[DEEP_MODEL] ?? { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }
    const afterT = after.tokensByModel[DEEP_MODEL]
    expect(afterT.inputTokens - beforeT.inputTokens).toBe(1000)
    expect(afterT.outputTokens - beforeT.outputTokens).toBe(500)
    expect(afterT.cacheWriteTokens - beforeT.cacheWriteTokens).toBe(200)
    expect(afterT.cacheReadTokens - beforeT.cacheReadTokens).toBe(4000)
  })

  it("records usage for a TRUNCATED call before throwing (truncated calls billed too)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    mockFetchWith({ ...USAGE_RESPONSE, stop_reason: "max_tokens" })
    const before = anthropicCallStats()
    const seen: TokenUsage[] = []
    await expect(
      claudeRaw({ tier: "reasoning", prompt: "x", thinking: true, onUsage: (u) => seen.push(u) }),
    ).rejects.toThrow(/truncated/)
    expect(seen).toHaveLength(1)
    const model = seen[0].model
    const after = anthropicCallStats()
    expect(after.tokensByModel[model].outputTokens - (before.tokensByModel[model]?.outputTokens ?? 0)).toBe(500)
  })

  it("swallows a throwing onUsage callback — telemetry must never break the call", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    mockFetchWith(USAGE_RESPONSE)
    const text = await claudeRaw({
      tier: "reasoning",
      prompt: "x",
      onUsage: () => {
        throw new Error("observer bug")
      },
    })
    expect(text).toBe("{}")
  })

  it("snapshots from anthropicCallStats are stable (deep-copied) for delta math", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key"
    mockFetchWith(USAGE_RESPONSE)
    await claudeRaw({ tier: "reasoning", prompt: "x", model: DEEP_MODEL, thinking: true })
    const snapshot = anthropicCallStats()
    const held = snapshot.tokensByModel[DEEP_MODEL].inputTokens
    await claudeRaw({ tier: "reasoning", prompt: "x", model: DEEP_MODEL, thinking: true })
    // the held snapshot must NOT move when later calls accrue
    expect(snapshot.tokensByModel[DEEP_MODEL].inputTokens).toBe(held)
  })
})

describe("estimateAnthropicCostUsd", () => {
  it("prices Sonnet and Opus at their per-MTok rates with cache multipliers", () => {
    // 1M in + 1M out + 1M cache-read + 1M cache-write, per model.
    const t = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }
    // Sonnet: 3 + 15 + 0.1*3 + 2*3 = 24.30
    expect(estimateAnthropicCostUsd({ "claude-sonnet-4-6": t })).toBeCloseTo(24.3, 5)
    // Opus: 5 + 25 + 0.5 + 10 = 40.50
    expect(estimateAnthropicCostUsd({ "claude-opus-4-8": t })).toBeCloseTo(40.5, 5)
    // both together sum
    expect(estimateAnthropicCostUsd({ "claude-sonnet-4-6": t, "claude-opus-4-8": t })).toBeCloseTo(64.8, 5)
  })

  it("prices an unknown model at Sonnet-tier instead of $0 (visible, not silent)", () => {
    const t = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    expect(estimateAnthropicCostUsd({ "future-model-x": t })).toBeCloseTo(3, 5)
  })
})
