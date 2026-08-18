// ALT-674 regression. Bryan got TWO "your first Ticket brief is ready" emails for 407 BBQ
// (2026-08-18) with two different headlines; Jersey Mike's shows the identical pattern a
// day earlier. Two brief runs per location, from two enqueue paths with different run_ids.
//
// These drive the notify step through a stubbed Supabase so the dedupe claim is exercised
// without a database, plus a plain assertion that the ledger insert precedes the send.

import { describe, it, expect, vi, beforeEach } from "vitest"

const sent: Array<{ to: string; subject: string }> = []
const inserted: Array<Record<string, unknown>> = []
let insertError: { code?: string; message?: string } | null = null

// Spread the real module: brief.ts also imports FROM_ADDRESS_TICKET / FROM_ADDRESS_NEAT
// from here, and a bare factory mock would drop them.
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  sendEmail: vi.fn(async (args: { to: string; subject: string }) => {
    sent.push({ to: args.to, subject: args.subject })
    return { ok: true }
  }),
}))

/** Minimal Supabase stub covering only what notify_first_brief touches. */
function stubSupabase() {
  return {
    from(table: string) {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        in: () => api,
        limit: () => api,
        maybeSingle: async () => {
          if (table === "organizations") return { data: { industry_type: "restaurant" } }
          if (table === "locations") return { data: { name: "407 BBQ" } }
          if (table === "profiles")
            return { data: { email: "owner@example.test", full_name: "Bryan Castles" } }
          return { data: null }
        },
        insert: async (row: Record<string, unknown>) => {
          if (table === "first_brief_sends") {
            inserted.push(row)
            return { error: insertError }
          }
          return { error: null }
        },
      }
      // organization_members is read as a list, not maybeSingle
      if (table === "organization_members") {
        return { select: () => ({ eq: () => ({ in: async () => ({ data: [{ user_id: "user-1" }] }) }) }) }
      }
      return api
    },
  }
}

async function runNotify() {
  const { buildBriefSteps } = await import("@/lib/jobs/pipelines/brief")
  const step = buildBriefSteps().find((s) => s.name === "notify_first_brief")!
  const ctx = {
    supabase: stubSupabase(),
    organizationId: "org-1",
    locationId: "loc-1",
    state: { isFirstBrief: true, headline: "Lead with [[brisket]], plan for [[heat]]" },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return step.run(ctx as any)
}

beforeEach(() => {
  sent.length = 0
  inserted.length = 0
  insertError = null
})

describe("ALT-674: the first-brief email is unrepeatable", () => {
  it("claims the send in first_brief_sends before emailing", async () => {
    await runNotify()
    expect(inserted).toEqual([{ location_id: "loc-1", user_id: "user-1" }])
    expect(sent).toHaveLength(1)
  })

  it("a 23505 unique violation means a concurrent run already sent it: SKIP, do not email", async () => {
    insertError = { code: "23505", message: "duplicate key value violates unique constraint" }
    await runNotify()
    expect(inserted).toHaveLength(1) // it tried
    expect(sent).toHaveLength(0) // but did not send. This is the bug being fixed.
  })

  it("any OTHER insert error still emails: breaking a promise beats a small double-send risk", async () => {
    insertError = { code: "08006", message: "connection failure" }
    await runNotify()
    expect(sent).toHaveLength(1)
  })

  it("does nothing at all when this is not the first brief", async () => {
    const { buildBriefSteps } = await import("@/lib/jobs/pipelines/brief")
    const step = buildBriefSteps().find((s) => s.name === "notify_first_brief")!
    const res = await step.run({
      supabase: stubSupabase(),
      organizationId: "org-1",
      locationId: "loc-1",
      state: { isFirstBrief: false, headline: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    expect(res).toMatchObject({ sent: 0 })
    expect(inserted).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })
})
