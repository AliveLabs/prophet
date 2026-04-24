"use client"

import { useEffect, useRef } from "react"
import posthog from "posthog-js"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"

// Bridges Supabase auth -> PostHog identity + marketing.contacts distinct_id.
//
// Fires on every SIGNED_IN event from supabase-js:
//   1. posthog.identify(userId, { email }) so PostHog links the anonymous
//      distinct_id to the real user going forward.
//   2. POST /api/marketing/posthog-bridge with distinct_id so the server can
//      mirror it into marketing.contacts.posthog_distinct_id.
//
// Both calls are idempotent; SIGNED_IN can fire on every tab focus / token
// refresh. A ref guards against sending the bridge POST more than once per
// session (the server is idempotent too, but saves a round-trip).

export default function PostHogIdentify() {
  const bridgedForUserId = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return

    const supabase = createBrowserSupabaseClient()

    const syncIdentity = (userId: string, email: string | null | undefined) => {
      try {
        posthog.identify(userId, email ? { email } : undefined)
      } catch (err) {
        console.warn("posthog.identify failed (non-fatal):", err)
      }

      if (bridgedForUserId.current === userId) return
      bridgedForUserId.current = userId

      let distinctId: string | undefined
      try {
        distinctId = posthog.get_distinct_id()
      } catch {
        return
      }
      if (!distinctId) return

      void fetch("/api/marketing/posthog-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distinct_id: distinctId }),
        credentials: "same-origin",
      }).catch((err) => {
        console.warn("posthog-bridge POST failed (non-fatal):", err)
      })
    }

    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) syncIdentity(data.user.id, data.user.email)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_IN" && session?.user) {
          syncIdentity(session.user.id, session.user.email)
        } else if (event === "SIGNED_OUT") {
          bridgedForUserId.current = null
          try {
            posthog.reset()
          } catch {
            // no-op
          }
        }
      }
    )

    return () => {
      subscription.subscription.unsubscribe()
    }
  }, [])

  return null
}
