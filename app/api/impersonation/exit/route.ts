import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { clearImpersonation } from "@/lib/auth/impersonation"
import {
  IMPERSONATION_COOKIE,
  verifyImpersonationCookie,
} from "@/lib/auth/impersonation-cookie"
import { logAdminAction } from "@/lib/admin/activity-log"

// End an impersonation session. Handles BOTH GET (banner Exit link + the proxy's 303 time-box
// teardown) AND POST (belt-and-suspenders, in case a non-GET ever reaches it directly) — so the
// teardown can never 405 and silently leave a live session. Not capability-gated: the browser
// holds the TARGET's session, and the signed cookie is the proof an admin started this. Reads
// the raw cookie (incl. expired) so the end is always attributed to the original actor. Signs
// out the target session, clears the flag, sends the admin to re-auth.
async function handleExit(request: Request) {
  const store = await cookies()
  const result = verifyImpersonationCookie(store.get(IMPERSONATION_COOKIE)?.value)
  if (result) {
    const { ctx, expired } = result
    await logAdminAction({
      adminId: ctx.actorAdminId,
      adminEmail: ctx.actorEmail,
      action: "user.impersonate.end",
      targetType: "user",
      targetId: ctx.targetUserId,
      details: { targetEmail: ctx.targetEmail, expired },
    })
  }

  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  await clearImpersonation()

  return NextResponse.redirect(new URL("/login?exited=impersonation", request.url))
}

export const GET = handleExit
export const POST = handleExit
