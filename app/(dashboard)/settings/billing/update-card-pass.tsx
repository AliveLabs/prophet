"use client"

// ALT-228: replaces ManageBillingPass on the operator Billing page. Plan
// changes and cancel now happen in-app (plan-change-tiles-pass.tsx,
// cancel-subscription-pass.tsx); the only thing still routed to Stripe is
// updating the tokenized card itself — the Portal session is scoped to just
// that flow via flow_data so the operator never sees plan/cancel controls
// twice, in two different places.

import { useState } from "react"
import { TkButton } from "@/components/ticket"
import { classifyBillingResponse, GENERIC_BILLING_ERROR } from "@/lib/billing/checkout-errors"

export function UpdateCardPass() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ALT-551: a failed Portal session (stale Stripe customer, impersonation read-only,
  // a member-role seat) used to just un-press the button with nothing shown.
  async function open() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: "payment_method_update" }),
      })
      const payload = await res.json().catch(() => null)
      const outcome = classifyBillingResponse(res.ok, payload)
      if (outcome.kind === "redirect") {
        window.location.assign(outcome.url)
        return
      }
      setError(outcome.message)
      setLoading(false)
    } catch {
      setError(GENERIC_BILLING_ERROR)
      setLoading(false)
    }
  }

  return (
    <>
      <TkButton variant="add" onClick={open} disabled={loading}>
        {loading ? "Opening…" : "Update card"}
      </TkButton>
      {error && (
        <span className="tk-set-status tk-set-status-err" role="alert">
          {error}
        </span>
      )}
    </>
  )
}
