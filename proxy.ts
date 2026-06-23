import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import {
  IMPERSONATION_COOKIE,
  verifyImpersonationCookie,
} from "@/lib/auth/impersonation-cookie"

// Next.js 16 proxy. Two jobs:
//   1. IMPERSONATION enforcement (Phase 6d) on EVERY route — central, so it can't be forgotten
//      per-action: while an impersonation session is active, block all mutations (non-GET) =
//      true read-only, and once the 30-min window elapses force a teardown (sign-out) so the
//      target session can't outlive its guardrails. Cheap cookie check; no-ops when absent.
//   2. ADMIN gate on /admin + /api/admin — optimistic signed-out → login bounce (the real
//      authorization is the DAL: layout + withAdminAction + requireCapability).

const EXIT_PATH = "/api/impersonation/exit"

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const method = req.method

  // ── Impersonation (all routes) ──────────────────────────────────────────────
  const imp = verifyImpersonationCookie(req.cookies.get(IMPERSONATION_COOKIE)?.value)
  if (imp && pathname !== EXIT_PATH) {
    if (imp.expired) {
      // Time-box elapsed → tear down the target session (the exit route signs out + clears).
      // 303 (not the default 307) so a non-GET that hits the expired window is converted to a
      // GET — otherwise a method-preserving redirect would 405 at the GET exit route and the
      // teardown would never run, leaving the session alive past its guardrail.
      return NextResponse.redirect(new URL(EXIT_PATH, req.url), 303)
    }
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      // Read-only: refuse every mutation (server-action POSTs + API writes) while impersonating.
      return NextResponse.json(
        { error: "Read-only while viewing as a user. Exit impersonation to make changes." },
        { status: 403 }
      )
    }
  }

  const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin")
  if (!isAdminArea) {
    return NextResponse.next({ request: { headers: req.headers } })
  }

  // ── Admin gate (/admin + /api/admin) ────────────────────────────────────────
  const isApi = pathname.startsWith("/api/admin")
  let res = NextResponse.next({ request: { headers: req.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        get(name) {
          return req.cookies.get(name)?.value
        },
        set(name, value, options) {
          req.cookies.set({ name, value, ...options })
          res = NextResponse.next({ request: { headers: req.headers } })
          res.cookies.set({ name, value, ...options })
        },
        remove(name, options) {
          req.cookies.set({ name, value: "", ...options })
          res = NextResponse.next({ request: { headers: req.headers } })
          res.cookies.set({ name, value: "", ...options })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("redirect", pathname)
    return NextResponse.redirect(url)
  }

  // Membership check via service-role (platform_admins isn't user-readable under RLS). Note:
  // while impersonating, `user` is the TARGET (non-admin) → this correctly bounces /admin.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  let isAdmin = false
  if (serviceKey) {
    const adminDb = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      serviceKey,
      { auth: { persistSession: false } }
    )
    const { data } = await adminDb
      .from("platform_admins")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle()
    isAdmin = !!data
  }

  if (!isAdmin) {
    if (isApi) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const url = req.nextUrl.clone()
    url.pathname = "/home"
    return NextResponse.redirect(url)
  }

  return res
}

// Broad matcher so impersonation read-only covers customer routes too. Excludes static assets,
// the auth callback, and login/signup (so an un-auth'd visitor can still reach them).
export const config = {
  // login/signup/auth are SEGMENT-anchored so only those exact routes are excluded — a future
  // /login-help or /signups must NOT silently bypass the central impersonation/admin gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login(?:/|$)|signup(?:/|$)|auth/).*)"],
}
