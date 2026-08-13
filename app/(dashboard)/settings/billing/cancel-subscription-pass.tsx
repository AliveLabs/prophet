"use client"

// ALT-228: in-app cancel/resume — POSTs /api/stripe/cancel, which schedules
// (or undoes) cancellation at period end, never immediately. Two-click
// confirm for the destructive path so a stray click can't cancel a live
// subscription.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { TkButton } from "@/components/ticket"
import { classifyBillingMutation, GENERIC_BILLING_ERROR } from "@/lib/billing/checkout-errors"

export function CancelSubscriptionPass({ cancelAtPeriodEnd }: { cancelAtPeriodEnd: boolean }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(resume: boolean) {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume }),
      })
      // ALT-551: parse defensively so an HTML error page surfaces as a message
      // rather than throwing into the catch and hiding the route's own reason.
      const payload = await res.json().catch(() => null)
      const outcome = classifyBillingMutation(res.ok, payload)
      if (outcome.kind === "error") {
        setError(outcome.message)
        setLoading(false)
        return
      }
      setConfirming(false)
      router.refresh()
    } catch {
      setError(GENERIC_BILLING_ERROR)
      setLoading(false)
    }
  }

  if (cancelAtPeriodEnd) {
    return (
      <div className="tk-set-row-actions">
        <TkButton variant="add" onClick={() => submit(true)} disabled={loading}>
          {loading ? "Resuming…" : "Resume subscription"}
        </TkButton>
        {error && <span className="tk-set-status tk-set-status-err">{error}</span>}
      </div>
    )
  }

  if (confirming) {
    return (
      <div className="tk-set-row-actions">
        <span className="tk-set-hint">
          Cancel at the end of your current period — you keep access until then.
        </span>
        <TkButton variant="dismiss" onClick={() => submit(false)} disabled={loading}>
          {loading ? "Canceling…" : "Confirm cancel"}
        </TkButton>
        <TkButton variant="ghost" onClick={() => setConfirming(false)} disabled={loading}>
          Keep subscription
        </TkButton>
        {error && <span className="tk-set-status tk-set-status-err">{error}</span>}
      </div>
    )
  }

  return (
    <div className="tk-set-row-actions">
      <TkButton variant="ghost" onClick={() => setConfirming(true)}>
        Cancel subscription
      </TkButton>
    </div>
  )
}
