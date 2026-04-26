"use client"

import { useState } from "react"

// Client-side wrapper around POST /api/stripe/portal. Placed next to the
// current-plan card so any customer with a Stripe customer ID can jump to
// the Customer Portal to update card, cancel, or switch plans.
export function ManageBillingButton() {
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
    <button
      onClick={open}
      disabled={loading}
      className="rounded-md border border-border bg-secondary px-3 py-1 text-xs font-semibold text-foreground hover:opacity-90 disabled:opacity-60"
    >
      {loading ? "Opening…" : "Manage billing"}
    </button>
  )
}
