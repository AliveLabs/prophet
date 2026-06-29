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
      {error ? (
        <div className="ob-alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          {error}
        </div>
      ) : null}
      <div className="ob-nav">
        <button className="ob-btn ob-btn--act" onClick={start} disabled={loading}>
          {loading ? "Opening secure checkout…" : "Start my free trial"}
          {!loading ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          ) : null}
        </button>
      </div>
      <p className="ob-hint">Secure checkout by Stripe.</p>
    </>
  )
}
