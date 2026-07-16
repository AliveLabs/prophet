// ---------------------------------------------------------------------------
// Anthropic model pricing — the admin cost-telemetry estimate (2026-07-16).
//
// ESTIMATES ONLY: billing truth is the Anthropic console. This exists so
// /admin/health can turn the per-build token telemetry (Brief.providerStats)
// into a $/brief and $/day figure without a console round-trip. Rates are
// per-MTok USD; update alongside any model swap. Cache reads bill at 0.1x the
// input rate; cache WRITES at 2x because the only TTL this codebase uses is
// the 1h ephemeral prefix (provider.ts buildSystemPayload) — the 5m TTL would
// be 1.25x, which we deliberately do not model.
// ---------------------------------------------------------------------------

export type ModelTokenTotals = {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
}

// Matched in order; first hit wins. Unknown models price as Sonnet-tier (the fleet base) so a
// new model id shows up as a plausible figure instead of $0 — the byModel split on the brief
// makes any mismatch visible.
const PER_MTOK_USD: Array<{ match: RegExp; input: number; output: number }> = [
  { match: /opus/i, input: 5, output: 25 },
  { match: /haiku/i, input: 1, output: 5 },
  { match: /sonnet/i, input: 3, output: 15 },
]
const DEFAULT_RATE = { input: 3, output: 15 }
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 2 // 1h-TTL ephemeral writes only

/** Estimated USD for a per-model token breakdown (Brief.providerStats.tokensByModel shape). */
export function estimateAnthropicCostUsd(tokensByModel: Record<string, ModelTokenTotals>): number {
  let usd = 0
  for (const [model, t] of Object.entries(tokensByModel)) {
    const rate = PER_MTOK_USD.find((r) => r.match.test(model)) ?? DEFAULT_RATE
    usd +=
      ((t.inputTokens ?? 0) / 1e6) * rate.input +
      ((t.outputTokens ?? 0) / 1e6) * rate.output +
      ((t.cacheReadTokens ?? 0) / 1e6) * rate.input * CACHE_READ_MULTIPLIER +
      ((t.cacheWriteTokens ?? 0) / 1e6) * rate.input * CACHE_WRITE_MULTIPLIER
  }
  return usd
}
