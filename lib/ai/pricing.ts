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

// Matched in order; FIRST HIT WINS, so specific ids must precede the family regexes. Unknown models
// price as Sonnet-tier (the fleet base) so a new model id shows up as a plausible figure instead of
// $0 — the byModel split on the brief makes any mismatch visible.
//
// ALT-544: the family regexes alone MISPRICE the Claude 5 family. `/opus/i` happens to be right for
// Opus 5 (same $5/$25 list price as Opus 4.8), but Fable/Mythos 5 fell through to the Sonnet-tier
// default ($3/$15 instead of $10/$50). Left alone, a model sweep would have produced a $/brief
// figure that looked plausible and was wrong.
//
// SONNET 5 IS $2/$10 PER MTOK, STANDING — NOT an expiring "intro" rate (2026-08-10 Anthropic
// announcement, verified): the previously-planned 2026-09-01 step-up to $3/$15 was cancelled.
// This file used to carry a date-gated introUntil/introInput/introOutput branch for that step-up;
// removed here because there is no longer a second rate to step up to. If Anthropic ever does
// reprice Sonnet 5, that is a new standing price, not a resurrection of the expiry mechanism.
//
// NOT corrected for here, deliberately: Sonnet 5's tokenizer emits roughly 30% more tokens for the
// same text. We price the token counts the API actually reports, so that shows up as real (higher)
// token volume rather than a rate adjustment. Do not "fix" it twice.
const PER_MTOK_USD: Array<{ match: RegExp; input: number; output: number }> = [
  // Fable / Mythos tier — above Opus, and invisible to every family regex below.
  { match: /fable|mythos/i, input: 10, output: 50 },
  // Sonnet 5: $2/$10 per MTok, standing (see the comment above the table).
  { match: /sonnet-5/i, input: 2, output: 10 },
  { match: /opus/i, input: 5, output: 25 },
  { match: /haiku/i, input: 1, output: 5 },
  { match: /sonnet/i, input: 3, output: 15 },
]
const DEFAULT_RATE = { input: 3, output: 15 }
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 2 // 1h-TTL ephemeral writes only

/** Per-model token DELTA between two `anthropicCallStats()` snapshots — i.e. one build's usage out of
 *  process-lifetime counters. Models with no movement are omitted. Extracted so the per-brief spend
 *  ceiling and the brief's own telemetry compute "this build's tokens" the same way. */
export function deltaTokensByModel(
  start: Record<string, ModelTokenTotals>,
  end: Record<string, ModelTokenTotals>,
): Record<string, ModelTokenTotals> {
  const out: Record<string, ModelTokenTotals> = {}
  for (const [model, e] of Object.entries(end)) {
    const s = start[model]
    const delta: ModelTokenTotals = {
      inputTokens: e.inputTokens - (s?.inputTokens ?? 0),
      outputTokens: e.outputTokens - (s?.outputTokens ?? 0),
      cacheWriteTokens: e.cacheWriteTokens - (s?.cacheWriteTokens ?? 0),
      cacheReadTokens: e.cacheReadTokens - (s?.cacheReadTokens ?? 0),
    }
    if (delta.inputTokens || delta.outputTokens || delta.cacheWriteTokens || delta.cacheReadTokens) {
      out[model] = delta
    }
  }
  return out
}

/** Per-MTok rate for a model id. No date parameter — every row above is a standing price (see the
 *  comment above PER_MTOK_USD for why Sonnet 5's $2/$10 is standing, not an expiring window). */
export function rateFor(model: string): { input: number; output: number } {
  const row = PER_MTOK_USD.find((r) => r.match.test(model))
  return row ? { input: row.input, output: row.output } : DEFAULT_RATE
}

/** Estimated USD for a per-model token breakdown (Brief.providerStats.tokensByModel shape). */
export function estimateAnthropicCostUsd(tokensByModel: Record<string, ModelTokenTotals>): number {
  let usd = 0
  for (const [model, t] of Object.entries(tokensByModel)) {
    const rate = rateFor(model)
    usd +=
      ((t.inputTokens ?? 0) / 1e6) * rate.input +
      ((t.outputTokens ?? 0) / 1e6) * rate.output +
      ((t.cacheReadTokens ?? 0) / 1e6) * rate.input * CACHE_READ_MULTIPLIER +
      ((t.cacheWriteTokens ?? 0) / 1e6) * rate.input * CACHE_WRITE_MULTIPLIER
  }
  return usd
}
