"use client"

// ALT-228: replaces ManageBillingPass on the operator Billing page. Plan
// changes and cancel now happen in-app (plan-change-tiles-pass.tsx,
// cancel-subscription-pass.tsx); the only thing still routed to Stripe is
// updating the tokenized card itself — the Portal session is scoped to just
// that flow via flow_data so the operator never sees plan/cancel controls
// twice, in two different places.

import { useState } from "react"
import { TkButton } from "@/components/ticket"

export function UpdateCardPass() {
  const [loading, setLoading] = useState(false)

  async function open() {
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: "payment_method_update" }),
      })
      const data = await res.json()
      if (data.url) window.location.assign(data.url)
      else setLoading(false)
    } catch {
      setLoading(false)
    }
  }

  return (
    <TkButton variant="add" onClick={open} disabled={loading}>
      {loading ? "Opening…" : "Update card"}
    </TkButton>
  )
}
