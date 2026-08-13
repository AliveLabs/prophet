"use client"

import { useState } from "react"
import { classifyBillingResponse, GENERIC_BILLING_ERROR } from "@/lib/billing/checkout-errors"

// Client-side wrapper around POST /api/stripe/portal. Placed next to the
// current-plan card so any customer with a Stripe customer ID can jump to
// the Customer Portal to update card, cancel, or switch plans.
//
// ALT-551: this button is on the held-account panel, the screen an expired
// operator lands on. A silent failure there is the difference between "I paid"
// and "I gave up", so every failure path now says something.
export function ManageBillingButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" })
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
      <button
        onClick={open}
        disabled={loading}
        className="pv-btn pv-btn--sm"
      >
        {loading ? "Opening…" : "Manage billing"}
      </button>
      {error && (
        <div className="pv-field__hint" role="alert">
          {error}
        </div>
      )}
    </>
  )
}
