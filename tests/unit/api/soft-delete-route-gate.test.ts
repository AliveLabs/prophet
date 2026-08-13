// ALT-578/ALT-580 — soft-deleted-org gap. Route handlers never pass through the
// (dashboard) layout's deleted_at gate, so /api/ask and the /api/ai/* routes could keep
// spending on behalf of a soft-deleted org's members. All four now resolve through the
// shared resolver (lib/auth/actor.ts's resolveOrgActorWith, ALT-577) instead of a hand-rolled
// profile read, which is what actually carries the deleted_at check (see
// tests/unit/auth/actor.test.ts for the resolver's own denial matrix). This file pins the
// WIRING only: each route must 403 when the resolver returns null, and must proceed past the
// gate (reach its own downstream logic, never a bare pass-through 200) when it returns an actor.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock("@/lib/auth/server", () => ({ getUser: vi.fn() }))
vi.mock("@/lib/auth/actor", () => ({
  resolveOrgActorWith: vi.fn(),
  // Real logic (mirrors lib/auth/actor.ts) — route tests below only exercise wiring, not this
  // predicate's own truth table (that's tests/unit/auth/actor.test.ts).
  isOrgAdmin: (actor: { role: string }) => actor.role === "owner" || actor.role === "admin",
}))
vi.mock("@/lib/http/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
  retryAfterSeconds: vi.fn().mockReturnValue(1),
}))
vi.mock("@/lib/ask/gather", () => ({ gatherAskContext: vi.fn() }))
vi.mock("@/lib/ask/answer", () => ({ answerQuestion: vi.fn(), MAX_QUESTION_LEN: 500 }))
vi.mock("@/lib/ask/how-to", () => ({ isHowToQuestion: vi.fn().mockReturnValue(false), answerHowTo: vi.fn() }))
vi.mock("@/lib/ask/history", () => ({ saveAsk: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/ai/quick-tip", () => ({ clampQuickTipContext: vi.fn().mockReturnValue(null) }))
// Beta rescue 2.2: quick-tip (claudeRaw) and insights/generate (claudeTransport) now run Haiku
// through the shared provider instead of Gemini. Both mocks reject so the routes' own fail-soft
// branches fire — proof the gate was passed without a real model call.
vi.mock("@/lib/ai/provider", () => ({
  claudeRaw: vi.fn().mockRejectedValue(new Error("boom")),
  claudeTransport: vi.fn().mockRejectedValue(new Error("boom")),
  FAST_MODEL: "claude-haiku-4-5",
}))
vi.mock("@/lib/ai/generated-insight", () => ({
  parseVizContext: vi.fn().mockReturnValue({ metric: "reviews", domain: "reviews", locationId: null, entityName: null }),
  buildGeneratedInsightPrompt: vi.fn().mockReturnValue("prompt"),
  generatedInsightType: vi.fn().mockReturnValue("user_viz.reviews"),
}))

import { POST as askPost } from "@/app/api/ask/route"
import { POST as chatPost } from "@/app/api/ai/chat/route"
import { POST as quickTipPost } from "@/app/api/ai/quick-tip/route"
import { POST as generateInsightPost } from "@/app/api/ai/insights/generate/route"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getUser } from "@/lib/auth/server"
import { resolveOrgActorWith } from "@/lib/auth/actor"

const USER = { id: "user_1", email: "jane@example.com" }
const ACTOR = { userId: "user_1", organizationId: "org_1", role: "owner" }

function req(body: unknown = {}) {
  return new Request("https://app.getticket.ai/api/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

/** Generic chainable Supabase stub: every table read resolves to an empty/absent result by
 *  default (overridable per-table via `rows`), enough for each route to walk past its own
 *  post-gate reads without erroring. */
function supabaseStub(rows: Record<string, unknown> = {}) {
  function chainFor(table: string): Record<string, unknown> {
    const data = table in rows ? rows[table] : null
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.in = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error: null })
    // Bare `await supabase.from(...).select(...)` (no maybeSingle) resolves the chain itself.
    chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: Array.isArray(data) ? data : data ? [data] : [], error: null })
    return chain
  }
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: USER } }) },
    from: vi.fn((table: string) => chainFor(table)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createServerSupabaseClient).mockResolvedValue(supabaseStub() as never)
  vi.mocked(getUser).mockResolvedValue(USER as never)
})

describe("POST /api/ask — soft-deleted org gate", () => {
  it("403s when the org actor cannot be resolved (no membership / soft-deleted org)", async () => {
    vi.mocked(resolveOrgActorWith).mockResolvedValue(null)
    const res = await askPost(req({ question: "how are we doing" }))
    expect(res.status).toBe(403)
  })

  it("passes the gate and reaches its own downstream logic for a live-org actor", async () => {
    vi.mocked(resolveOrgActorWith).mockResolvedValue(ACTOR as never)
    const res = await askPost(req({ question: "how are we doing" }))
    // No location resolves from the stub, so the route's OWN "no location" guard fires next —
    // proof the gate was passed, not the gate's 403.
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("no location")
  })
})

describe("POST /api/ai/chat — soft-deleted org gate", () => {
  it("403s when the org actor cannot be resolved", async () => {
    vi.mocked(resolveOrgActorWith).mockResolvedValue(null)
    const res = await chatPost(req({ question: "how are we doing" }))
    expect(res.status).toBe(403)
  })

  it("passes the gate and reaches the stub LLM-not-configured response for a live-org actor", async () => {
    vi.mocked(resolveOrgActorWith).mockResolvedValue(ACTOR as never)
    const res = await chatPost(req({ question: "how are we doing" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe("LLM not configured yet")
  })
})

describe("POST /api/ai/quick-tip — soft-deleted org gate", () => {
  it("403s when the org actor cannot be resolved", async () => {
    vi.mocked(resolveOrgActorWith).mockResolvedValue(null)
    const res = await quickTipPost(req({ context: "busy Friday night" }))
    expect(res.status).toBe(403)
  })

  it("passes the gate and reaches its own downstream logic for a live-org actor", async () => {
    vi.mocked(resolveOrgActorWith).mockResolvedValue(ACTOR as never)
    const res = await quickTipPost(req({ context: "busy Friday night" }))
    // clampQuickTipContext is mocked to return null, so the route's own no-context short
    // circuit returns tip:null with a 200 (not the gate's 403).
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tip).toBeNull()
  })
})

describe("POST /api/ai/insights/generate — soft-deleted org gate", () => {
  it("403s when the org actor cannot be resolved", async () => {
    vi.mocked(resolveOrgActorWith).mockResolvedValue(null)
    const res = await generateInsightPost(req({ vizContext: "{}" }))
    expect(res.status).toBe(403)
  })

  it("403s a real member of a live org who is not owner/admin (RLS-mirrored gate, unchanged)", async () => {
    vi.mocked(resolveOrgActorWith).mockResolvedValue({ ...ACTOR, role: "member" } as never)
    const res = await generateInsightPost(req({ vizContext: "{}" }))
    expect(res.status).toBe(403)
  })

  it("passes the gate and reaches the model call for an owner/admin of a live org", async () => {
    vi.mocked(resolveOrgActorWith).mockResolvedValue(ACTOR as never)
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      supabaseStub({ locations: [{ id: "loc_1" }] }) as never,
    )
    const res = await generateInsightPost(req({ vizContext: "{}" }))
    // claudeTransport is mocked to reject, so the route's own fail-soft "model_failed"
    // branch fires next — proof the gate (and the admin check) were passed.
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.reason).toBe("model_failed")
  })
})
