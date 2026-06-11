"use client"

import { useState } from "react"

// Posts the onboarding trial checkout (mid tier, monthly, 14-day trial with
// card required) and hands the browser to Stripe. Success returns through
// /onboarding/checkout-complete; cancel returns here with ?canceled=1.
export default function StartTrialButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: "mid", cadence: "monthly", context: "onboarding" }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.assign(data.url)
        return
      }
      setError(data.error ?? "Couldn't start checkout. Try again.")
      setLoading(false)
    } catch {
      setError("Couldn't start checkout. Try again.")
      setLoading(false)
    }
  }

  return (
    <>
      {error ? <div className="ob-alert">{error}</div> : null}
      <div className="ob-nav">
        <button className="ob-btn" onClick={start} disabled={loading}>
          {loading ? "Opening secure checkout…" : "Start my free trial →"}
        </button>
      </div>
      <p className="ob-hint">Secure checkout by Stripe.</p>
    </>
  )
}
