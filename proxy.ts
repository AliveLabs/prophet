import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

// Next.js 16 proxy (the renamed middleware). Runs at the network boundary before /admin and
// /api/admin requests are handled.
//
// IMPORTANT — this is NOT the authorization boundary. Per Next.js 16 guidance, proxy/middleware
// must not be relied on for auth (the well-known middleware-bypass risk). The REAL gate lives in
// the data-access layer and runs on every code path:
//   • app/admin/layout.tsx          -> requirePlatformAdminContext() (redirects non-admins)
//   • every admin server action      -> withAdminAction(capability, …)
//   • /api/admin/* route handlers     -> requireCapability(…)
//
// This layer is only an OPTIMISTIC redirect: bounce a signed-out visitor to /login before we
// render or run anything, which is nicer UX than rendering then redirecting. It deliberately
// does NOT load the service-role client or query platform_admins — admin membership and
// per-capability checks are the DAL's job. A signed-in non-admin is allowed through here and
// then redirected by the layout / refused by the action.

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
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
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("redirect", pathname)
    return NextResponse.redirect(url)
  }

  return res
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
}
