import { cookies } from "next/headers"
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_COOKIE_MAX_AGE_SECONDS,
  type ImpersonationContext,
  serializeImpersonation,
  verifyImpersonationCookie,
} from "./impersonation-cookie"

// Server-side impersonation cookie I/O (Phase 6d). The codec (sign/verify/exp) lives in the
// pure ./impersonation-cookie module so proxy.ts can verify the cookie too. The functional
// 30-min time-box is enforced by proxy (forces sign-out past exp); here getImpersonation()
// treats an expired cookie as inactive so the banner + read-only signal disappear. The cookie
// itself persists past exp (longer maxAge) so the proxy can still see it and tear the session
// down — a cookie that vanished at exp would strand a live, unguarded target session.

export {
  type ImpersonationContext,
  IMPERSONATION_MAX_AGE_SECONDS,
} from "./impersonation-cookie"

export async function setImpersonation(ctx: ImpersonationContext): Promise<void> {
  const store = await cookies()
  store.set(IMPERSONATION_COOKIE, serializeImpersonation(ctx), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_COOKIE_MAX_AGE_SECONDS,
  })
}

/** Active (non-expired, valid) impersonation context, or null. */
export async function getImpersonation(): Promise<ImpersonationContext | null> {
  const store = await cookies()
  const result = verifyImpersonationCookie(store.get(IMPERSONATION_COOKIE)?.value)
  if (!result || result.expired) return null
  return result.ctx
}

export async function clearImpersonation(): Promise<void> {
  const store = await cookies()
  store.delete(IMPERSONATION_COOKIE)
}

/**
 * Defense-in-depth read-only block for sensitive customer mutations. The PRIMARY read-only
 * enforcement is central (proxy blocks non-GET while impersonating); this lets specific
 * server actions also return a clean failure. Returns the failure when impersonating, else null.
 */
export async function impersonationReadOnlyBlock(): Promise<{ ok: false; error: string } | null> {
  if (!(await getImpersonation())) return null
  return {
    ok: false,
    error: "Disabled while viewing as a user (impersonation is read-only). Exit impersonation to make changes.",
  }
}
