// App root = the door, not a destination. The marketing site (www.getticket.ai) is the
// real front door; this subdomain is the product. Authenticated sessions go straight to
// their brief; everyone else gets the login screen. The old throwaway landing funnel
// (and its duplicate waitlist form) is retired — components/landing/* removed in a later
// cleanup pass.
//
// cacheComponents pattern (canonical for this repo): a SYNC page exporting a <Suspense>
// with a static fallback; the async child reads the session cookie and issues a streamed
// redirect — same mechanism the authed shell uses for unauthenticated /home hits.

import { Suspense } from "react"
import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export default function Root() {
  return (
    <Suspense fallback={null}>
      <SessionGate />
    </Suspense>
  )
}

async function SessionGate() {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  redirect(data?.user ? "/home" : "/login")
  return null // unreachable; satisfies the JSX component return type
}
