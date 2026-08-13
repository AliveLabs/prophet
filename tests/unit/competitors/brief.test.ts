// Beta rescue 2.2 — the per-competitor intel brief moved from a raw Gemini fetch to Haiku via
// the shared provider (lib/ai/provider.ts claudeTransport). These tests pin the two things the
// swap must not change: the failure contract (null on ANY failure — the UI renders nothing) and
// the request shape (FAST_MODEL, explicit output cap, spend-telemetry callback wired).

import { describe, it, expect, vi } from "vitest"
import { generateCompetitorBrief } from "@/lib/competitors/brief"
import { FAST_MODEL } from "@/lib/ai/provider"
import type { GenerateRequest } from "@/lib/ai/provider"

// recordSpendEvent hits the admin Supabase client on usage; the tests below never fire onUsage
// (the mock transports don't call it), but mock it anyway so an accidental fire can't touch env.
vi.mock("@/lib/ai/spend-events", () => ({ recordSpendEvent: vi.fn().mockResolvedValue(undefined) }))

const INSIGHTS = [
  { title: "Rating up", summary: "4.2 → 4.5", severity: "info", insight_type: "rating", date_key: "2026-08-10" },
  { title: "New hours", summary: "Now open Mondays", severity: "warning", insight_type: "hours", date_key: null },
]

describe("generateCompetitorBrief", () => {
  it("returns the brief when the transport yields valid JSON, and sends the Haiku request shape", async () => {
    const transport = vi.fn(async (_req: GenerateRequest) => ({
      narrative: "They raised **4.5**.",
      suggestedAction: "Respond to reviews.",
    }))

    const brief = await generateCompetitorBrief("Fog Harbor", INSIGHTS, { transport })

    expect(brief).toEqual({ narrative: "They raised **4.5**.", suggestedAction: "Respond to reviews." })
    const captured = transport.mock.calls[0][0]
    expect(captured.model).toBe(FAST_MODEL)
    expect(captured.tier).toBe("reasoning")
    // Explicit cap — the pre-swap Gemini call was capped too (400); never send uncapped.
    expect(captured.maxOutputTokens).toBe(512)
    expect(captured.onUsage).toBeTypeOf("function") // spend telemetry stays wired
    expect(captured.prompt).toContain("Fog Harbor")
    expect(captured.prompt).toContain("[INFO] Rating up")
    expect(captured.prompt).toContain("[WARNING] New hours")
  })

  it("caps the prompt at 15 signals", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      title: `Signal ${i}`, summary: "s", severity: "info", insight_type: "t", date_key: null,
    }))
    const transport = vi.fn(async (_req: GenerateRequest) => ({ narrative: "n", suggestedAction: "a" }))
    await generateCompetitorBrief("X", many, { transport })
    const captured = transport.mock.calls[0][0]
    expect(captured.prompt).toContain("Signal 14")
    expect(captured.prompt).not.toContain("Signal 15")
  })

  it("returns null (never throws) when the transport throws — timeout, 4xx, truncation", async () => {
    const transport = vi.fn(async () => {
      throw new Error("Anthropic request timed out after 60000ms")
    })
    await expect(generateCompetitorBrief("X", INSIGHTS, { transport })).resolves.toBeNull()
  })

  it("returns null when the model output parses but misses a required field", async () => {
    for (const bad of [
      null,
      {},
      { narrative: "only one field" },
      { narrative: "", suggestedAction: "empty narrative" },
      { narrative: 42, suggestedAction: "wrong type" },
    ]) {
      const transport = vi.fn(async () => bad)
      await expect(generateCompetitorBrief("X", INSIGHTS, { transport })).resolves.toBeNull()
    }
  })

  it("returns null without calling the transport when there are no insights", async () => {
    const transport = vi.fn()
    await expect(generateCompetitorBrief("X", [], { transport })).resolves.toBeNull()
    expect(transport).not.toHaveBeenCalled()
  })
})
