import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getImpersonation } from "@/lib/auth/impersonation"
import { isTouchDue, touchLastSeen } from "@/lib/auth/presence"

export async function getUser() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    return null
  }
  return data.user
}

export async function requireUser() {
  const user = await getUser()
  if (!user) {
    redirect("/login")
  }

  // Presence stamp for the admin panel's "Last seen". This is the one chokepoint every
  // authenticated surface already passes through, so it needs no per-page wiring.
  //
  // Fire-and-forget on purpose: presence is telemetry and must never delay or break a render.
  // touchLastSeen throttles itself to one write per user per 5 minutes, so this is a no-op on
  // the overwhelming majority of requests. Skipped while impersonating — an admin viewing a
  // customer's dashboard is not that customer being active.
  if (isTouchDue(user.id)) {
    void (async () => {
      try {
        if (await getImpersonation()) return
        const supabase = await createServerSupabaseClient()
        await touchLastSeen(supabase, user.id)
      } catch {
        // Never surface a presence failure to the request.
      }
    })()
  }

  return user
}
