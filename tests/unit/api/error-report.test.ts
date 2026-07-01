// ALT-243: POST /api/error-report — the client error boundary (app/error.tsx / app/global-error.tsx)
// posts {digest, url, timestamp, message} here so a hard crash can reach the team. This pins the
// contract: validate the body, enrich with user/org SERVER-SIDE from the session (never trust
// client-supplied identity), send via the existing Resend email infra to the ops distribution list,
// and never throw even when session/org lookup comes back empty (a crash reporter must not itself
// 500 on a logged-out or mid-crash user).

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/email/templates/error-report", () => ({ ErrorReportEmail: vi.fn(() => null) }))
vi.mock("@/lib/admin/activity-log", () => ({ logAdminAction: vi.fn(), SYSTEM_ACTOR_ID: "00000000-0000-0000-0000-000000000000" }))

import { POST } from "@/app/api/error-report/route"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { logAdminAction } from "@/lib/admin/activity-log"

function req(body: unknown) {
  return new Request("https://app.getticket.ai/api/error-report", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function mockSupabaseServer(user: { id: string; email: string } | null) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } } as never) },
  } as never)
}

function mockSupabaseAdmin(opts: { membership?: { organization_id: string } | null; org?: { name: string } | null } = {}) {
  const from = vi.fn((table: string) => {
    if (table === "organization_members") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: opts.membership ?? null }),
          }),
        }),
      }
    }
    if (table === "organizations") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: opts.org ?? null }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: "email_1" } as never)
  mockSupabaseServer(null)
  mockSupabaseAdmin()
})

describe("POST /api/error-report", () => {
  it("rejects a body missing the required digest/url/timestamp fields", async () => {
    const res = await POST(req({ message: "oops" }))
    expect(res.status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("sends the report email with digest, url, and timestamp when no session is present", async () => {
    const res = await POST(
      req({
        digest: "abc123",
        url: "https://app.getticket.ai/home",
        timestamp: "2026-06-30T12:00:00.000Z",
        message: "TypeError: x is not a function",
      })
    )

    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const call = vi.mocked(sendEmail).mock.calls[0][0]
    expect(call.clientFacing).toBeFalsy()
    expect(call.subject).toContain("abc123")
  })

  it("enriches the report with user/org server-side when a session is present", async () => {
    mockSupabaseServer({ id: "user_1", email: "jane@example.com" })
    mockSupabaseAdmin({
      membership: { organization_id: "org_1" },
      org: { name: "Jane's Diner" },
    })

    const res = await POST(
      req({
        digest: "def456",
        url: "https://app.getticket.ai/insights",
        timestamp: "2026-06-30T12:05:00.000Z",
      })
    )

    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    // Enrichment must come from the session/org lookup, not from any client-supplied field —
    // the test body above supplies no user/org at all.
    const templateMock = await import("@/lib/email/templates/error-report")
    const props = vi.mocked(templateMock.ErrorReportEmail).mock.calls[0][0] as {
      userEmail?: string
      orgName?: string
    }
    expect(props.userEmail).toBe("jane@example.com")
    expect(props.orgName).toBe("Jane's Diner")
  })

  it("still succeeds (degrades gracefully) when session lookup finds no user", async () => {
    mockSupabaseServer(null)

    const res = await POST(
      req({
        digest: "ghi789",
        url: "https://app.getticket.ai/home",
        timestamp: "2026-06-30T12:10:00.000Z",
      })
    )

    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it("returns ok:false (not a 500) when the email send fails, so the client can fall back to mailto", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "Resend not configured" } as never)

    const res = await POST(
      req({
        digest: "jkl012",
        url: "https://app.getticket.ai/home",
        timestamp: "2026-06-30T12:15:00.000Z",
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it("persists a queryable record of the report via the admin activity log", async () => {
    await POST(
      req({
        digest: "mno345",
        url: "https://app.getticket.ai/home",
        timestamp: "2026-06-30T12:20:00.000Z",
        message: "boom",
      })
    )

    expect(logAdminAction).toHaveBeenCalledTimes(1)
    const call = vi.mocked(logAdminAction).mock.calls[0][0]
    expect(call.action).toBe("error_report.submitted")
    expect(call.details).toMatchObject({ digest: "mno345", url: "https://app.getticket.ai/home" })
  })
})
