import { createHmac, timingSafeEqual } from "node:crypto"

// Pure (no next/headers) impersonation-cookie codec — shared by the server helpers
// (lib/auth/impersonation.ts) AND proxy.ts, which must verify the cookie from req.cookies
// without the next/headers cookie store.

export const IMPERSONATION_COOKIE = "tkt_impersonation"

// Functional window: past this the session is torn down (proxy forces sign-out) and the
// banner/read-only guards treat it as inactive.
export const IMPERSONATION_MAX_AGE_SECONDS = 30 * 60

// The cookie itself lives LONGER than the functional window so it survives past `exp` and can
// still trigger the teardown on the next request (a cookie that vanished at exp would leave the
// underlying Supabase session alive with no signal — the bug the review caught).
export const IMPERSONATION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60

export interface ImpersonationContext {
  actorAdminId: string
  actorEmail: string
  targetUserId: string
  targetEmail: string
  /** epoch ms; functional expiry (NOT the cookie maxAge). */
  exp: number
}

// HMAC key. Prefer a DEDICATED IMPERSONATION_SIGNING_SECRET so that admin-session forgery and
// DB-godmode aren't the same key (SEC-H1): a future leak of the service-role key should not also
// let an attacker forge impersonation cookies. Falls back to SUPABASE_SERVICE_ROLE_KEY when the
// dedicated secret is unset, so this change is non-breaking — set IMPERSONATION_SIGNING_SECRET in
// the environment to cut over (in-flight impersonation cookies signed with the old key simply stop
// verifying at cutover, which safely ends those sessions). Fail CLOSED if NEITHER is present —
// never sign/verify with an empty key (that would make the signature forgeable).
function signingKey(): string {
  const k = process.env.IMPERSONATION_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!k)
    throw new Error(
      "impersonation: no signing key (set IMPERSONATION_SIGNING_SECRET or SUPABASE_SERVICE_ROLE_KEY)"
    )
  return k
}

function sign(payloadB64: string): string {
  return createHmac("sha256", signingKey()).update(payloadB64).digest("base64url")
}

export function serializeImpersonation(ctx: ImpersonationContext): string {
  const payloadB64 = Buffer.from(JSON.stringify(ctx)).toString("base64url")
  return `${payloadB64}.${sign(payloadB64)}`
}

/**
 * Verify + parse a raw cookie value. Returns the context plus whether it's past its functional
 * expiry, or null if absent / malformed / signature-invalid. Callers decide what to do with an
 * expired-but-valid cookie (the banner/guards ignore it; the proxy tears the session down).
 */
export function verifyImpersonationCookie(
  raw: string | undefined | null
): { ctx: ImpersonationContext; expired: boolean } | null {
  if (!raw) return null
  const dot = raw.indexOf(".")
  if (dot < 0) return null
  const payloadB64 = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  let expected: string
  try {
    expected = sign(payloadB64)
  } catch {
    return null // missing key → fail closed
  }
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const ctx = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as ImpersonationContext
    if (!ctx.actorAdminId || !ctx.targetUserId || typeof ctx.exp !== "number") return null
    return { ctx, expired: Date.now() > ctx.exp }
  } catch {
    return null
  }
}
