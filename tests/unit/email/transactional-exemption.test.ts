// D7 unsubscribe, HARD REQUIREMENT (Bryan): transactional email is exempt
// from the marketing opt-out BY CONSTRUCTION, not by a runtime check.
//
// A fully opted-out contact must still receive password resets, magic links,
// billing notices, receipts, and security mail. The way that is guaranteed is
// that the transactional send path NEVER READS the opt-out state at all:
// there is no flag to get wrong, no query to mis-scope, no boolean anyone can
// invert later.
//
// This file enforces both halves:
//   1. RUNTIME  -- a send for an opted-out address goes out, and the opt-out
//                  storage layer and the Supabase admin client are never
//                  touched during it.
//   2. STATIC   -- no file under lib/email/** references the suppression
//                  module, its export, or the opt-out column. That is the
//                  guard against a future "just check the flag here" edit,
//                  which the runtime test alone would not catch on a path it
//                  does not exercise.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const sendMock = vi.fn()

vi.mock("@/lib/email/client", () => ({
  resend: { emails: { send: (...args: unknown[]) => sendMock(...args) } },
}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock("@/lib/marketing/suppression", () => ({
  setMarketingEmailOptOut: vi.fn(),
}))

import { sendEmail } from "@/lib/email/send"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { setMarketingEmailOptOut } from "@/lib/marketing/suppression"

// Stands in for any transactional template (magic link, receipt, security
// notice). sendEmail takes a ReactElement; the shape is all that matters here.
const TEMPLATE = { type: "div", props: {}, key: null } as never

// This address is opted out of marketing everywhere it matters. It is stated
// as a fact of the fixture rather than seeded anywhere, because the point of
// the test is that NOTHING in this path can observe that fact.
const OPTED_OUT = "opted-out@example.com"

beforeEach(() => {
  vi.clearAllMocks()
  sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null })
})

describe("transactional email ignores the marketing opt-out", () => {
  it("sends to a fully opted-out contact and never reads the opt-out state", async () => {
    const result = await sendEmail({
      to: OPTED_OUT,
      subject: "Your sign-in link",
      react: TEMPLATE,
      overrideClientEmailPause: true,
    })

    expect(result.ok).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: [OPTED_OUT] })

    // The opt-out never entered the decision: no suppression call, and no
    // admin client (the only route to the marketing schema) constructed.
    expect(setMarketingEmailOptOut).not.toHaveBeenCalled()
    expect(createAdminSupabaseClient).not.toHaveBeenCalled()
  })

  it("still sends when marketing contacts are enabled and a secret is configured", async () => {
    // Nothing about the marketing configuration can gate a transactional send.
    const priorFlag = process.env.MARKETING_CONTACTS_ENABLED
    const priorSecret = process.env.UNSUB_SECRET
    process.env.MARKETING_CONTACTS_ENABLED = "true"
    process.env.UNSUB_SECRET = "test-unsub-secret-value"
    try {
      const result = await sendEmail({
        to: OPTED_OUT,
        subject: "Payment failed",
        react: TEMPLATE,
        clientFacing: true,
        overrideClientEmailPause: true,
      })
      expect(result.ok).toBe(true)
      expect(createAdminSupabaseClient).not.toHaveBeenCalled()
    } finally {
      if (priorFlag === undefined) delete process.env.MARKETING_CONTACTS_ENABLED
      else process.env.MARKETING_CONTACTS_ENABLED = priorFlag
      if (priorSecret === undefined) delete process.env.UNSUB_SECRET
      else process.env.UNSUB_SECRET = priorSecret
    }
  })
})

describe("the transactional email layer cannot see the opt-out (static)", () => {
  const emailDir = path.resolve(__dirname, "../../../lib/email")

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
  }

  // Anything that would couple a transactional send to marketing opt-out
  // state. Keep this list in sync with lib/marketing/suppression.ts.
  const FORBIDDEN = [
    "marketing/suppression",
    "setMarketingEmailOptOut",
    "unsubscribed_at",
  ]

  it("has files to check (guards against a silently empty scan)", () => {
    const files = walk(emailDir).filter((f) => /\.tsx?$/.test(f))
    expect(files.length).toBeGreaterThan(10)
  })

  it("references nothing from the marketing opt-out layer", () => {
    const offenders: string[] = []
    for (const file of walk(emailDir).filter((f) => /\.tsx?$/.test(f))) {
      const source = readFileSync(file, "utf8")
      for (const needle of FORBIDDEN) {
        if (source.includes(needle)) {
          offenders.push(`${path.relative(emailDir, file)}: ${needle}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
