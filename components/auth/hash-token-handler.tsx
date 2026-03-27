"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"

export function HashTokenHandler() {
  const router = useRouter()
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (!hash || !hash.includes("access_token=")) return

    setProcessing(true)

    const params = new URLSearchParams(hash.substring(1))
    const accessToken = params.get("access_token")
    const refreshToken = params.get("refresh_token")

    if (!accessToken || !refreshToken) {
      setProcessing(false)
      return
    }

    const supabase = createBrowserSupabaseClient()

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(async ({ data, error }) => {
        if (error || !data.user) {
          window.location.hash = ""
          setProcessing(false)
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
        setProcessing(false)
      })
  }, [router])

  if (!processing) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-precision-teal" />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  )
}
