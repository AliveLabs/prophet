// SEC-H1: the impersonation cookie codec is the trust anchor for "view as customer" — a forgeable
// signature would let anyone mint an admin-granted session. These pin the HMAC contract: a cookie
// only verifies under the exact signing key, tampering is rejected, the dedicated
// IMPERSONATION_SIGNING_SECRET is preferred but falls back to the service-role key (non-breaking),
// rotation/cutover invalidates in-flight cookies, and it fails CLOSED with no key.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  serializeImpersonation,
  verifyImpersonationCookie,
  type ImpersonationContext,
} from "@/lib/auth/impersonation-cookie"

const ctx = (over: Partial<ImpersonationContext> = {}): ImpersonationContext => ({
  actorAdminId: "admin-1",
  actorEmail: "admin@x.io",
  targetUserId: "user-9",
  targetEmail: "user@x.io",
  exp: Date.now() + 60_000,
  ...over,
})

const ENV = process.env
beforeEach(() => {
  process.env = { ...ENV }
  delete process.env.IMPERSONATION_SIGNING_SECRET
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})
afterEach(() => {
  process.env = ENV
})

describe("impersonation cookie codec", () => {
  it("round-trips a context under a dedicated signing secret", () => {
    process.env.IMPERSONATION_SIGNING_SECRET = "secret-A"
    const r = verifyImpersonationCookie(serializeImpersonation(ctx()))
    expect(r?.ctx.actorAdminId).toBe("admin-1")
    expect(r?.ctx.targetUserId).toBe("user-9")
    expect(r?.expired).toBe(false)
  })

  it("does NOT verify under a different key (rotation / forgery defense)", () => {
    process.env.IMPERSONATION_SIGNING_SECRET = "secret-A"
    const raw = serializeImpersonation(ctx())
    process.env.IMPERSONATION_SIGNING_SECRET = "secret-B"
    expect(verifyImpersonationCookie(raw)).toBeNull()
  })

  it("rejects a tampered payload (signature no longer matches)", () => {
    process.env.IMPERSONATION_SIGNING_SECRET = "secret-A"
    const raw = serializeImpersonation(ctx())
    const sig = raw.slice(raw.indexOf(".") + 1)
    const forgedPayload = Buffer.from(JSON.stringify(ctx({ actorAdminId: "attacker" }))).toString("base64url")
    expect(verifyImpersonationCookie(`${forgedPayload}.${sig}`)).toBeNull()
  })

  it("falls back to SUPABASE_SERVICE_ROLE_KEY when the dedicated secret is unset (back-compat)", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "srk"
    const r = verifyImpersonationCookie(serializeImpersonation(ctx()))
    expect(r?.ctx.targetUserId).toBe("user-9")
  })

  it("cutover to a dedicated secret invalidates cookies signed with the old service-role key", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "srk"
    const raw = serializeImpersonation(ctx())
    process.env.IMPERSONATION_SIGNING_SECRET = "new-dedicated" // takes precedence now
    expect(verifyImpersonationCookie(raw)).toBeNull()
  })

  it("fails CLOSED when no signing key is present", () => {
    expect(() => serializeImpersonation(ctx())).toThrow()
    process.env.IMPERSONATION_SIGNING_SECRET = "k"
    const raw = serializeImpersonation(ctx())
    delete process.env.IMPERSONATION_SIGNING_SECRET
    expect(verifyImpersonationCookie(raw)).toBeNull() // can't recompute the signature → reject
  })

  it("flags a valid-but-past-exp cookie as expired (drives the proxy teardown)", () => {
    process.env.IMPERSONATION_SIGNING_SECRET = "k"
    const r = verifyImpersonationCookie(serializeImpersonation(ctx({ exp: Date.now() - 1_000 })))
    expect(r?.expired).toBe(true)
  })

  it("returns null for absent / malformed input", () => {
    process.env.IMPERSONATION_SIGNING_SECRET = "k"
    expect(verifyImpersonationCookie(null)).toBeNull()
    expect(verifyImpersonationCookie("")).toBeNull()
    expect(verifyImpersonationCookie("no-dot-here")).toBeNull()
  })
})
