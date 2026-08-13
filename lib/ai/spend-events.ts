// ---------------------------------------------------------------------------
// Non-brief AI spend telemetry (beta rescue Phase 2.3).
//
// Brief builds already record token/cost telemetry into daily_briefs.brief->providerStats
// (2026-07-16, /admin/health). Every OTHER model call (the /insights Priority Briefing call,
// /api/ai/quick-tip, /api/ai/insights/generate, /api/ask, the nightly eval-judge cron, the
// weekly ingest-knowledge-feeds cron, and the insights pipeline's own Gemini calls) was
// invisible to us and only showed up on the provider console after the fact. This module is the
// one recorder every one of those call sites writes through.
//
// FIRE-AND-FORGET CONTRACT: recordSpendEvent() never throws. A telemetry write failing (bad env,
// RLS, network) must never turn a real, working call into a failed response, and must never add
// meaningful latency to it: it mirrors the posture of lib/eval/record.ts (observation only, never
// mutates the real call path, never blocks on failure). Call sites in a user-facing request path
// should NOT await this (fire it and move on); call sites already inside a background cron/batch
// loop MAY await it so the write lands before the function suspends. Either way is safe, because
// this function resolves on any internal failure instead of rejecting.
//
// `ai_spend_events` is not yet in the generated DB types (its migration,
// supabase/migrations/20260812140000_ai_spend_events.sql, has not been applied), so this uses the
// same posture the rest of the app uses for a not-yet-regenerated table (see beta_feedback in
// app/(dashboard)/feedback-actions.ts): a small loose-client cast instead of the typed Database
// client.
// ---------------------------------------------------------------------------

import { estimateAnthropicCostUsd } from "@/lib/ai/pricing"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type SpendSurface =
  | "priority_briefing"
  | "quick_tip"
  | "ask"
  | "eval_judge"
  | "insights_generate"
  | "knowledge_ingest"
  | "insights_pipeline"
  // Per-competitor intel brief (lib/competitors/brief.ts) — instrumented 2026-08-12 when it moved
  // from an un-telemetered raw Gemini fetch to Haiku via the shared provider. The `surface` column
  // is deliberately NOT CHECK-constrained (see the migration), so no migration is needed here.
  | "competitor_brief"

export type SpendProvider = "anthropic" | "gemini"

export type SpendEventInput = {
  surface: SpendSurface
  provider: SpendProvider
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Omit or null when the call has no single location to attribute to (e.g. eval_judge,
   *  knowledge_ingest: both are fleet/batch operations). */
  locationId?: string | null
  /** Free-form context (e.g. { skillId, sourceId }). Never put anything sensitive here: it
   *  lands in a jsonb column with no row-level access control beyond service-role-only. */
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Gemini per-MTok USD, ESTIMATES ONLY (verified against Google's published Gemini API list
// prices 2026-08-12, text tier). Pro is tiered by prompt size: both input AND output reprice
// when the prompt exceeds 200k tokens (Google prices output by prompt size, not output size).
// Our prompts sit far below that, but the tier is modeled so an outlier prices correctly.
// No per-token Gemini rate existed anywhere in this codebase before this file.
// lib/billing/cost-model.ts carries flat PER-CALL estimates for a different purpose (onboarding
// cost projection) and is deliberately NOT reused here: keeping the two independent means a
// change to one never silently reprices the other. Billing truth is the Google AI Studio /
// Cloud console, exactly as pricing.ts says the Anthropic console is truth for that provider.
// ---------------------------------------------------------------------------
type GeminiRate = {
  input: number
  output: number
  /** Rates applied to the WHOLE call when the prompt exceeds thresholdTokens. */
  longPrompt?: { thresholdTokens: number; input: number; output: number }
}
const GEMINI_PER_MTOK_USD: Record<string, GeminiRate> = {
  "gemini-2.5-pro": {
    input: 1.25,
    output: 10,
    longPrompt: { thresholdTokens: 200_000, input: 2.5, output: 15 },
  },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
}
// Unrecognised Gemini model ids price as -pro (the more expensive tier) so a new model id shows
// up as a plausible, slightly-conservative figure instead of silently $0, same reasoning as
// pricing.ts's unknown-Anthropic-model default.
const GEMINI_DEFAULT_RATE = GEMINI_PER_MTOK_USD["gemini-2.5-pro"]

function rateForGemini(model: string): GeminiRate {
  for (const [key, rate] of Object.entries(GEMINI_PER_MTOK_USD)) {
    if (model.includes(key)) return rate
  }
  return GEMINI_DEFAULT_RATE
}

/** Estimated USD for one call's token counts. Exported for the recorder's own unit tests. */
export function estimateSpendUsd(input: SpendEventInput): number {
  const inputTokens = input.inputTokens ?? 0
  const outputTokens = input.outputTokens ?? 0
  const cacheReadTokens = input.cacheReadTokens ?? 0
  const cacheWriteTokens = input.cacheWriteTokens ?? 0
  if (input.provider === "anthropic") {
    return estimateAnthropicCostUsd({
      [input.model]: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
    })
  }
  // Gemini: these call sites don't use explicit context caching, so there is no separate
  // cache-write rate to model; any cache-read tokens (if ever populated) price at the plain
  // input rate rather than being dropped.
  const baseRate = rateForGemini(input.model)
  const promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens
  const rate =
    baseRate.longPrompt && promptTokens > baseRate.longPrompt.thresholdTokens
      ? baseRate.longPrompt
      : baseRate
  return (promptTokens / 1e6) * rate.input + (outputTokens / 1e6) * rate.output
}

type SpendEventsClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
  }
}

/**
 * Record one non-brief AI call's spend into ai_spend_events. NEVER throws: any failure (missing
 * env, RLS, network, the table not existing yet in a given environment) is caught and logged with
 * console.warn, never surfaced to the caller. Safe to call without awaiting; also safe to await
 * (it always resolves, never rejects).
 */
export async function recordSpendEvent(input: SpendEventInput): Promise<void> {
  try {
    const estimatedUsd = estimateSpendUsd(input)
    const admin = createAdminSupabaseClient() as unknown as SpendEventsClient
    const { error } = await admin.from("ai_spend_events").insert({
      surface: input.surface,
      provider: input.provider,
      model: input.model,
      input_tokens: input.inputTokens ?? 0,
      output_tokens: input.outputTokens ?? 0,
      cache_read_tokens: input.cacheReadTokens ?? 0,
      cache_write_tokens: input.cacheWriteTokens ?? 0,
      estimated_usd: estimatedUsd,
      location_id: input.locationId ?? null,
      metadata: input.metadata ?? {},
    })
    if (error) {
      console.warn(`[spend-events] insert failed (surface=${input.surface}):`, error.message)
    }
  } catch (err) {
    console.warn(`[spend-events] recorder threw (surface=${input.surface}), ignored:`, err)
  }
}
