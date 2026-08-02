"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import { describeAuthLinkError } from "@/lib/auth/link-errors"

export function HashTokenHandler() {
  const router = useRouter()
  const didRun = useRef(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (didRun.current) return
    const hash = window.location.hash
    if (!hash) return

    const params = new URLSearchParams(hash.substring(1))

    // A rejected link arrives as #error=access_denied&error_code=otp_expired.
    // This used to return early (no `access_token=`), leaving the operator on a
    // blank sign-in page with no explanation — the silent half of the beta-invite
    // dead end. Surface it through the same ?error banner the form already shows.
    const linkError = describeAuthLinkError({
      error: params.get("error"),
      errorCode: params.get("error_code"),
      errorDescription: params.get("error_description"),
    })
    if (linkError) {
      didRun.current = true
      window.location.hash = ""
      router.replace(`/login?error=${encodeURIComponent(linkError)}`)
      return
    }

    if (!hash.includes("access_token=")) return

    didRun.current = true

    const accessToken = params.get("access_token")
    const refreshToken = params.get("refresh_token")

    if (!accessToken || !refreshToken) return

    if (overlayRef.current) {
      overlayRef.current.style.display = "flex"
    }

    const supabase = createBrowserSupabaseClient()

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(async ({ data, error }) => {
        if (error || !data.user) {
          window.location.hash = ""
          if (overlayRef.current) overlayRef.current.style.display = "none"
          return
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("current_organization_id")
          .eq("id", data.user.id)
          .maybeSingle()

        window.location.hash = ""
        router.replace(profile?.current_organization_id ? "/home" : "/onboarding")
      })
      .catch(() => {
        window.location.hash = ""
        if (overlayRef.current) overlayRef.current.style.display = "none"
      })
  }, [router])

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 items-center justify-center bg-background"
      style={{ display: "none" }}
    >
      <div className="text-center space-y-3">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-precision-teal" />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  )
}
