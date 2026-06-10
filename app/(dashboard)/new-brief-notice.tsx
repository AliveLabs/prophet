"use client"

// In-app new-brief notification (complete-picture · Batch 4, "start in-app" scope):
// when a brief newer than the last one this browser saw exists, raise a toast that
// links to /home. Visiting /home marks it seen. Respects the comms pref; web push
// can layer on later without changing this seam.

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

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

  useEffect(() => {
    if (!generatedAt) return
    const seenKey = `ticket:brief-seen:${locationId}`
    if (pathname === "/home" || pathname.startsWith("/home/")) {
      localStorage.setItem(seenKey, generatedAt)
      return
    }
    if (!enabled) return
    const seen = localStorage.getItem(seenKey)
    if (seen && seen >= generatedAt) return
    const notifiedKey = `${seenKey}:notified`
    if (sessionStorage.getItem(notifiedKey) === generatedAt) return
    sessionStorage.setItem(notifiedKey, generatedAt)
    toast("Your new brief is ready", {
      description: "Fresh signals came in this morning.",
      action: { label: "Read it", onClick: () => router.push("/home") },
    })
  }, [pathname, generatedAt, locationId, enabled, router])

  return null
}
