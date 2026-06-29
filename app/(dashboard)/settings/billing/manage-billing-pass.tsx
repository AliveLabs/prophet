"use client"

// Manage-billing button, rebuilt to The Pass. Same wired behavior as
// manage-billing-button.tsx — POSTs /api/stripe/portal and redirects to the
// Stripe Customer Portal. Presentation only: kit TkButton.

import { useState } from "react"
import { TkButton } from "@/components/ticket"

export function ManageBillingPass() {
  const [loading, setLoading] = useState(false)

  async function open() {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" })
      const data = await res.json()
      if (data.url) window.location.assign(data.url)
      else setLoading(false)
    } catch {
      setLoading(false)
    }
  }

  return (
    <TkButton variant="add" onClick={open} disabled={loading}>
      {loading ? "Opening…" : "Manage billing"}
    </TkButton>
  )
}
