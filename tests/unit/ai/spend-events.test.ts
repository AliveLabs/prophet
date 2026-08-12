// Non-brief AI spend telemetry (beta rescue 2.3). Two things this guards:
//   (1) the pricing math: Anthropic delegates to lib/ai/pricing.ts (must stay consistent with
//       the brief-pipeline estimate), Gemini uses this module's own small per-MTok table.
//   (2) the recorder's no-throw contract: a telemetry write failing (bad env, RLS, a thrown
//       client) must never surface to the caller. Mirrors tests/unit/ai/usage-telemetry.test.ts's
//       "swallows a throwing callback" posture, one layer further out.

import { describe, it, expect, vi, beforeEach } from "vitest"

const { insertMock, fromMock, createAdminSupabaseClientMock } = vi.hoisted(() => {
  const insertMock = vi.fn(async (_row: Record<string, unknown>) => ({ error: null as { message: string } | null }))
  const fromMock = vi.fn((_table: string) => ({ insert: insertMock }))
  const createAdminSupabaseClientMock = vi.fn(() => ({ from: fromMock }))
  return { insertMock, fromMock, createAdminSupabaseClientMock }
})

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: createAdminSupabaseClientMock,
}))

import { estimateSpendUsd, recordSpendEvent, type SpendEventInput } from "@/lib/ai/spend-events"
import { estimateAnthropicCostUsd } from "@/lib/ai/pricing"

const baseInput: SpendEventInput = {
  surface: "ask",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
}

describe("estimateSpendUsd", () => {
  it("Anthropic: matches lib/ai/pricing.ts's own estimate for the same tokens (single source of truth)", () => {
    const input: SpendEventInput = { ...baseInput, provider: "anthropic", model: "claude-sonnet-5-x", cacheReadTokens: 500_000, cacheWriteTokens: 250_000 }
    const viaPricing = estimateAnthropicCostUsd({
      [input.model]: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 500_000, cacheWriteTokens: 250_000 },
    })
    expect(estimateSpendUsd(input)).toBe(viaPricing)
  })

  it("Gemini: gemini-2.5-pro prices at $1.25 in / $10 out per MTok", () => {
    const usd = estimateSpendUsd({ ...baseInput, provider: "gemini", model: "gemini-2.5-pro" })
    expect(usd).toBeCloseTo(1.25 + 10, 6)
  })

  it("Gemini: gemini-2.5-flash is materially cheaper than pro at the same token counts", () => {
    const flash = estimateSpendUsd({ ...baseInput, provider: "gemini", model: "gemini-2.5-flash" })
    const pro = estimateSpendUsd({ ...baseInput, provider: "gemini", model: "gemini-2.5-pro" })
    expect(flash).toBeCloseTo(0.3 + 2.5, 6)
    expect(flash).toBeLessThan(pro)
  })

  it("Gemini: an unrecognised model id prices as -pro (conservative default), never $0", () => {
    const unknown = estimateSpendUsd({ ...baseInput, provider: "gemini", model: "gemini-9000-ultra" })
    const pro = estimateSpendUsd({ ...baseInput, provider: "gemini", model: "gemini-2.5-pro" })
    expect(unknown).toBe(pro)
    expect(unknown).toBeGreaterThan(0)
  })

  it("zero tokens price at $0 for both providers", () => {
    expect(estimateSpendUsd({ surface: "ask", provider: "anthropic", model: "claude-sonnet-4-6" })).toBe(0)
    expect(estimateSpendUsd({ surface: "quick_tip", provider: "gemini", model: "gemini-2.5-flash" })).toBe(0)
  })
})

describe("recordSpendEvent", () => {
  beforeEach(() => {
    insertMock.mockClear()
    fromMock.mockClear()
    createAdminSupabaseClientMock.mockClear()
    insertMock.mockResolvedValue({ error: null })
  })

  it("inserts the expected row shape into ai_spend_events", async () => {
    await recordSpendEvent({
      surface: "priority_briefing",
      provider: "gemini",
      model: "gemini-2.5-pro",
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 10,
      locationId: "loc-1",
      metadata: { note: "test" },
    })
    expect(fromMock).toHaveBeenCalledWith("ai_spend_events")
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = insertMock.mock.calls[0][0]
    expect(row).toMatchObject({
      surface: "priority_briefing",
      provider: "gemini",
      model: "gemini-2.5-pro",
      input_tokens: 100,
      output_tokens: 200,
      cache_read_tokens: 10,
      cache_write_tokens: 0,
      location_id: "loc-1",
      metadata: { note: "test" },
    })
    expect(typeof row.estimated_usd).toBe("number")
  })

  it("defaults missing token/location/metadata fields instead of sending undefined", async () => {
    await recordSpendEvent({ surface: "eval_judge", provider: "anthropic", model: "claude-sonnet-4-6" })
    const row = insertMock.mock.calls[0][0]
    expect(row).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      location_id: null,
      metadata: {},
    })
  })

  it("never throws when the insert resolves with a DB error (logs a warning instead)", async () => {
    insertMock.mockResolvedValueOnce({ error: { message: "permission denied for table ai_spend_events" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(recordSpendEvent(baseInput)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("never throws when the insert call itself throws", async () => {
    insertMock.mockImplementationOnce(async () => {
      throw new Error("network error")
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(recordSpendEvent(baseInput)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("never throws when createAdminSupabaseClient itself throws (e.g. missing env)", async () => {
    createAdminSupabaseClientMock.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(recordSpendEvent(baseInput)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
