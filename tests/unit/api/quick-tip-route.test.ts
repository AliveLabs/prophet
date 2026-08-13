// Beta rescue 2.2 — /api/ai/quick-tip moved from a raw Gemini Flash fetch to Haiku via the
// shared provider (claudeRaw). This pins the swapped call's contract: the tip text passes
// through on success, EVERY failure serves { tip: null } (never a 5xx — it backs a loading
// overlay), the call runs retry-free on FAST_MODEL, and a missing ANTHROPIC_API_KEY short-
// circuits before any model call. Gate wiring (401/403/429) is pinned separately in
// tests/unit/api/soft-delete-route-gate.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/auth/server", () => ({ getUser: vi.fn() }))
vi.mock("@/lib/auth/actor", () => ({ resolveOrgActorWith: vi.fn() }))
vi.mock("@/lib/http/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
  retryAfterSeconds: vi.fn().mockReturnValue(1),
}))
vi.mock("@/lib/ai/provider", () => ({
  claudeRaw: vi.fn(),
  FAST_MODEL: "claude-haiku-4-5",
}))
vi.mock("@/lib/ai/spend-events", () => ({ recordSpendEvent: vi.fn().mockResolvedValue(undefined) }))

import { POST } from "@/app/api/ai/quick-tip/route"
import { getUser } from "@/lib/auth/server"
import { resolveOrgActorWith } from "@/lib/auth/actor"
import { claudeRaw } from "@/lib/ai/provider"

function req(body: unknown = { context: "a taqueria in Dallas with slipping weekday lunch" }) {
  return new Request("https://app.getticket.ai/api/ai/quick-tip", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

const hadKey = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  vi.mocked(getUser).mockResolvedValue({ id: "user_1", email: "jane@example.com" } as never)
  vi.mocked(resolveOrgActorWith).mockResolvedValue({ userId: "user_1", organizationId: "org_1", role: "owner" } as never)
  vi.mocked(claudeRaw).mockReset()
  process.env.ANTHROPIC_API_KEY = "test-key"
})

afterEach(() => {
  if (hadKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = hadKey
})

describe("POST /api/ai/quick-tip (Haiku swap contract)", () => {
  it("returns the trimmed tip text on success, from a retry-free FAST_MODEL call", async () => {
    vi.mocked(claudeRaw).mockResolvedValue("  Push your weekday lunch combo on Google Posts.  ")
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tip: "Push your weekday lunch combo on Google Posts." })

    const [request, opts] = vi.mocked(claudeRaw).mock.calls[0]
    expect(request.model).toBe("claude-haiku-4-5")
    expect(request.tier).toBe("reasoning")
    expect(request.maxOutputTokens).toBe(300) // explicit cap, never unbounded
    expect(request.onUsage).toBeTypeOf("function") // spend telemetry stays wired
    expect(request.prompt).toContain("a taqueria in Dallas")
    expect(opts).toEqual({ retries: 0 }) // overlay call: fail now, don't back off
  })

  it("serves { tip: null } with a 200 when the model call throws", async () => {
    vi.mocked(claudeRaw).mockRejectedValue(new Error("Anthropic error 429: rate limited"))
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tip: null })
  })

  it("serves { tip: null } when the model returns only whitespace", async () => {
    vi.mocked(claudeRaw).mockResolvedValue("   ")
    const res = await POST(req())
    expect(await res.json()).toEqual({ tip: null })
  })

  it("short-circuits to { tip: null } without a model call when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tip: null })
    expect(claudeRaw).not.toHaveBeenCalled()
  })

  it("short-circuits to { tip: null } without a model call on an empty context", async () => {
    const res = await POST(req({ context: "" }))
    expect(await res.json()).toEqual({ tip: null })
    expect(claudeRaw).not.toHaveBeenCalled()
  })
})
