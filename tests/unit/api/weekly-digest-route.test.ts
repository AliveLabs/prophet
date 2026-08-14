// D6: the weekly digest must be UNSENDABLE until Bryan's content review.
// This pins the route-level gate: with WEEKLY_DIGEST_EMAILS_ENABLED off, the
// cron does no DB work and sends nothing -- and flipping the GLOBAL
// CLIENT_EMAILS_ENABLED does NOT unpause it (that flag would also unpause
// welcome + waitlist-confirm, which is exactly what the per-email override
// pattern exists to avoid). Also pins the per-user day filter at the route.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock("@/lib/insights/daily-brief", () => ({ getBrief: vi.fn() }))
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/email/templates/weekly-digest", () => ({ WeeklyDigest: vi.fn(() => null) }))

import { GET } from "@/app/api/cron/weekly-digest/route"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getBrief } from "@/lib/insights/daily-brief"
import { sendEmail } from "@/lib/email/send"

const CRON_SECRET = "cron_secret_test"
const ET = "America/New_York"
// 2026-08-17 13:00Z = Monday 9 AM in New York (inside the 8 AM + 4h window).
const MON_9AM_ET = new Date("2026-08-17T13:00:00Z")

const dedupeInserts: Record<string, unknown>[] = []

function armAdmin(opts: { digestDay?: unknown; timezone?: string | null } = {}) {
  dedupeInserts.length = 0
  const tables: Record<string, unknown[]> = {
    locations: [
      {
        id: "loc_1",
        name: "Ada's",
        organization_id: "org_1",
        settings: {},
        timezone: opts.timezone === undefined ? ET : opts.timezone,
      },
    ],
    organizations: [
      { id: "org_1", subscription_tier: "mid", trial_ends_at: "2099-01-01", payment_state: null },
    ],
    organization_members: [{ user_id: "user_1" }],
    profiles: [{ id: "user_1", email: "owner@rest.com", weekly_digest_day: opts.digestDay ?? 1 }],
  }
  // Thenable chain: every filter returns the chain, and awaiting it anywhere
  // resolves to { data, error } -- so .select().in().is() and .select().eq()
  // both work without enumerating each PostgREST combination.
  const builder = (table: string) => {
    const rows = tables[table] ?? []
    const chain: Record<string, unknown> = {
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
      insert: async (row: Record<string, unknown>) => {
        dedupeInserts.push(row)
        return { error: null }
      },
    }
    for (const method of ["select", "order", "eq", "in", "is", "not", "gt", "gte", "limit"]) {
      chain[method] = () => chain
    }
    return chain
  }
  vi.mocked(createAdminSupabaseClient).mockReturnValue({
    from: builder,
  } as unknown as ReturnType<typeof createAdminSupabaseClient>)
}

const req = () =>
  new Request("https://x/api/cron/weekly-digest", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(MON_9AM_ET)
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  vi.mocked(getBrief).mockResolvedValue({
    headline: "Patio weather lands Thursday",
    deck: "Three moves.",
    plays: [{ title: "Post the patio", kind: "social" }],
  } as unknown as Awaited<ReturnType<typeof getBrief>>)
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: "e1" } as Awaited<
    ReturnType<typeof sendEmail>
  >)
  armAdmin()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("GET /api/cron/weekly-digest — the D6 send gate", () => {
  it("rejects an unauthorized call before anything else", async () => {
    vi.stubEnv("WEEKLY_DIGEST_EMAILS_ENABLED", "true")
    const res = await GET(new Request("https://x/api/cron/weekly-digest"))
    expect(res.status).toBe(401)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("with the override OFF: sends nothing, touches no DB, and says so explicitly", async () => {
    for (const v of ["false", "", "1", "TRUE"]) {
      vi.stubEnv("WEEKLY_DIGEST_EMAILS_ENABLED", v)
      const res = await GET(req())
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.enabled).toBe(false)
      expect(body.sent).toBe(0)
      expect(String(body.reason)).toContain("WEEKLY_DIGEST_EMAILS_ENABLED")
    }
    expect(createAdminSupabaseClient).not.toHaveBeenCalled()
    expect(getBrief).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("the GLOBAL client-email flag does NOT unpause the digest", async () => {
    vi.stubEnv("CLIENT_EMAILS_ENABLED", "true")
    vi.stubEnv("WEEKLY_DIGEST_EMAILS_ENABLED", "false")
    const body = await (await GET(req())).json()
    expect(body.enabled).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("with the override ON: sends to a recipient whose chosen day is today, and bypasses the global pause per-email", async () => {
    vi.stubEnv("WEEKLY_DIGEST_EMAILS_ENABLED", "true")
    const body = await (await GET(req())).json()
    expect(body.enabled).toBe(true)
    expect(body.sent).toBe(1)
    expect(sendEmail).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        to: "owner@rest.com",
        clientFacing: true,
        overrideClientEmailPause: true,
      })
    )
  })

  it("passes the 'change the day' settings deep link into the template", async () => {
    vi.stubEnv("WEEKLY_DIGEST_EMAILS_ENABLED", "true")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.getticket.ai")
    const { WeeklyDigest } = await import("@/lib/email/templates/weekly-digest")
    await GET(req())
    expect(WeeklyDigest).toHaveBeenCalledWith(
      expect.objectContaining({ digestDayUrl: "https://app.getticket.ai/settings#weekly-digest" })
    )
  })

  it("writes the dedupe row BEFORE sending (a retried tick in the catch-up window can't double-send)", async () => {
    vi.stubEnv("WEEKLY_DIGEST_EMAILS_ENABLED", "true")
    await GET(req())
    expect(dedupeInserts).toEqual([
      { user_id: "user_1", location_id: "loc_1", date_key: "2026-08-17" },
    ])
  })

  it("skips a recipient whose chosen day is not today, without fetching a brief", async () => {
    vi.stubEnv("WEEKLY_DIGEST_EMAILS_ENABLED", "true")
    armAdmin({ digestDay: 4 }) // Thursday
    const body = await (await GET(req())).json()
    expect(body.sent).toBe(0)
    expect(getBrief).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("treats a missing weekly_digest_day column as the Monday default (correct before the migration is applied)", async () => {
    vi.stubEnv("WEEKLY_DIGEST_EMAILS_ENABLED", "true")
    armAdmin({ digestDay: undefined })
    const body = await (await GET(req())).json()
    expect(body.sent).toBe(1)
  })
})
