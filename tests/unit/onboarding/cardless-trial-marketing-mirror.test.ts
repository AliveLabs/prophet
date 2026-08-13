// ALT-591: the card-less trial path must enter the nurture flow.
//
// startTrialWithoutCardAction is the ONLY trial start Stripe never sees, so
// before this fix a "skip for now" operator had no marketing.contacts row and
// received zero lifecycle email. These tests pin: the mirror fires with status
// 'trial', it is AWAITED before redirect() throws (a fire-and-forget promise
// would be cut off), and every guard/idempotency early-return still skips it.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // Mirrors Next's real behavior: redirect() throws to unwind the action.
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock("@/lib/auth/server", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock("@/lib/marketing/trial-lifecycle", () => ({
  mirrorLifecycleToMarketing: vi.fn(),
  marketingSourceForIndustry: vi.fn(() => "getticket.ai"),
}))
// Module-graph stubs: this action file pulls in the whole onboarding toolchain.
vi.mock("@/lib/jobs/triggers", () => ({ triggerInitialLocationData: vi.fn() }))
vi.mock("@/lib/places/google", () => ({
  fetchPlaceDetails: vi.fn(),
  fetchNearbyPlaces: vi.fn(),
  mapPlaceToLocation: vi.fn(),
}))
vi.mock("@/lib/providers/scoring", () => ({
  scoreCompetitor: vi.fn(),
  EXCLUDED_COMPETITOR_TYPES: [],
}))
vi.mock("@/lib/ai/provider", () => ({ generateStructured: vi.fn() }))
vi.mock("@/lib/competitors/discover", () => ({
  buildTargetIdentity: vi.fn(),
  buildRerankPrompt: vi.fn(),
  parseRerank: vi.fn(),
  sanitizeWhy: vi.fn(),
  discoveryTypeTiles: vi.fn(() => []),
  DISCOVERY_RADIUS_METERS: 1,
  RERANK_POOL_CAP: 1,
  RERANK_VETO_BELOW: 1,
  DISCOVERY_KEEP: 1,
}))
vi.mock("@/lib/jobs/queue", () => ({ enqueueFirstRun: vi.fn() }))
vi.mock("@/lib/http/rate-limit", () => ({ rateLimit: vi.fn() }))
vi.mock("@/lib/billing/limits", () => ({ ensureCanAddLocation: vi.fn() }))
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn(() => Promise.resolve({ ok: true })) }))
vi.mock("@/lib/email/templates/welcome", () => ({ Welcome: vi.fn(() => null) }))

import { startTrialWithoutCardAction } from "@/app/onboarding/actions"
import { requireUser } from "@/lib/auth/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { mirrorLifecycleToMarketing } from "@/lib/marketing/trial-lifecycle"

/** Minimal admin-client stub covering the four reads + one update the action makes. */
function armAdmin(opts: {
  currentOrgId?: string | null
  role?: string | null
  org?: { payment_state: string | null; trial_ends_at: string | null } | null
  updateError?: { message: string } | null
}) {
  const updates: Record<string, unknown>[] = []
  const rows: Record<string, unknown> = {
    profiles: { current_organization_id: opts.currentOrgId ?? "org_1" },
    organization_members: opts.role === null ? null : { role: opts.role ?? "owner" },
    organizations:
      opts.org === undefined ? { payment_state: null, trial_ends_at: null } : opts.org,
  }
  vi.mocked(createAdminSupabaseClient).mockReturnValue({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: rows[table] ?? null }) }),
          maybeSingle: async () => ({ data: rows[table] ?? null }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(values)
          return { error: opts.updateError ?? null }
        },
      }),
    }),
  } as unknown as ReturnType<typeof createAdminSupabaseClient>)
  return { updates }
}

/** The action always ends in redirect(), which throws. Capture the target. */
async function runAction(): Promise<string> {
  try {
    await startTrialWithoutCardAction()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  return "no-redirect"
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({
    id: "user_1",
    email: "owner@rest.com",
  } as unknown as Awaited<ReturnType<typeof requireUser>>)
  vi.mocked(mirrorLifecycleToMarketing).mockResolvedValue(undefined)
})

describe("startTrialWithoutCardAction — marketing mirror (ALT-591)", () => {
  it("mirrors the card-less trial start at status 'trial' and still redirects home", async () => {
    const { updates } = armAdmin({})
    const outcome = await runAction()
    expect(updates[0]).toHaveProperty("trial_started_at")
    expect(mirrorLifecycleToMarketing).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org_1",
      status: "trial",
      fallbackEmail: "owner@rest.com",
    })
    expect(outcome).toBe("NEXT_REDIRECT:/home")
  })

  it("awaits the mirror BEFORE redirect() throws (a fire-and-forget write would be cut off)", async () => {
    armAdmin({})
    const order: string[] = []
    vi.mocked(mirrorLifecycleToMarketing).mockImplementation(async () => {
      await Promise.resolve()
      order.push("mirror")
    })
    await runAction()
    order.push("redirect")
    expect(order).toEqual(["mirror", "redirect"])
  })

  it("does not mirror when the clock write failed (no trial actually started)", async () => {
    armAdmin({ updateError: { message: "db down" } })
    const outcome = await runAction()
    expect(outcome).toContain("NEXT_REDIRECT:/onboarding/trial?error=")
    expect(mirrorLifecycleToMarketing).not.toHaveBeenCalled()
  })

  it("does not mirror on the idempotency replays (Stripe already owns the clock / live clock exists)", async () => {
    armAdmin({ org: { payment_state: "trialing", trial_ends_at: null } })
    expect(await runAction()).toBe("NEXT_REDIRECT:/home")

    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({
      id: "user_1",
      email: "owner@rest.com",
    } as unknown as Awaited<ReturnType<typeof requireUser>>)
    armAdmin({
      org: {
        payment_state: null,
        trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    })
    expect(await runAction()).toBe("NEXT_REDIRECT:/home")
    expect(mirrorLifecycleToMarketing).not.toHaveBeenCalled()
  })

  it("does not mirror when the caller is not an owner/admin of the org", async () => {
    armAdmin({ role: "member" })
    expect(await runAction()).toBe("NEXT_REDIRECT:/onboarding?error=Unauthorized")
    expect(mirrorLifecycleToMarketing).not.toHaveBeenCalled()
  })
})
