"use client"

// In-app new-brief notification (complete-picture · Batch 4, "start in-app" scope):
// when a brief newer than the last one this browser saw exists, raise a toast that
// links to /home. Visiting /home marks it seen. Respects the comms pref; web push
// can layer on later without changing this seam.
//
// ALT-229b: the server-rendered `generatedAt` only changes on a navigation/refresh, so
// the toast never fired while an operator sat on a page when a brief landed. We now poll
// /api/briefs/latest on an interval (and on tab refocus) so the notice fires off the page
// too — no realtime infra. Polling is cheap (one indexed stamp read) and only runs while
// the notice is enabled and the tab is visible.

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

const POLL_MS = 5 * 60 * 1000 // 5 min — briefs land at most daily; this is just to catch one without a refresh.

export default function NewBriefNotice({
  locationId,
  generatedAt,
  enabled,
}: {
  locationId: string
  generatedAt: string | null
  enabled: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  // Newest stamp polling has SEEN (null until a poll returns one). The effective latest is
  // max(server-rendered generatedAt, polled) — derived at render, so no sync effect is
  // needed to reconcile a newer server stamp after a navigation.
  const [polledAt, setPolledAt] = useState<string | null>(null)
  const latestAt =
    generatedAt && polledAt ? (generatedAt > polledAt ? generatedAt : polledAt) : generatedAt ?? polledAt

  // Poll for a fresher brief while enabled + visible (skips /home — being there marks seen).
  useEffect(() => {
    if (!enabled) return
    if (pathname === "/home" || pathname.startsWith("/home/")) return

    let cancelled = false
    async function check() {
      if (document.visibilityState !== "visible") return
      try {
        const res = await fetch(`/api/briefs/latest?location_id=${encodeURIComponent(locationId)}`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const data = (await res.json()) as { generatedAt: string | null }
        if (cancelled || !data.generatedAt) return
        setPolledAt((prev) => (!prev || data.generatedAt! > prev ? data.generatedAt : prev))
      } catch {
        // Polling is best-effort — a transient failure just means we catch it next tick
        // (or on the next navigation's server stamp). Never surface a poll error.
      }
    }

    const id = setInterval(check, POLL_MS)
    const onFocus = () => check()
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [enabled, pathname, locationId])

  // Fire the toast when the latest stamp is newer than what this browser has seen.
  useEffect(() => {
    if (!latestAt) return
    const seenKey = `ticket:brief-seen:${locationId}`
    if (pathname === "/home" || pathname.startsWith("/home/")) {
      localStorage.setItem(seenKey, latestAt)
      return
    }
    if (!enabled) return
    const seen = localStorage.getItem(seenKey)
    if (seen && seen >= latestAt) return
    const notifiedKey = `${seenKey}:notified`
    if (sessionStorage.getItem(notifiedKey) === latestAt) return
    sessionStorage.setItem(notifiedKey, latestAt)
    toast("Your new brief is ready", {
      description: "Fresh signals just came in.",
      action: { label: "Read it", onClick: () => router.push("/home") },
    })
  }, [pathname, latestAt, locationId, enabled, router])

  return null
}
