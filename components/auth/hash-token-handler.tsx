"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"

export function HashTokenHandler() {
  const router = useRouter()
  const didRun = useRef(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (didRun.current) return
    const hash = window.location.hash
    if (!hash || !hash.includes("access_token=")) return

    didRun.current = true

    const params = new URLSearchParams(hash.substring(1))
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
