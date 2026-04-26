"use client"

import { useState } from "react"

interface DunningBannerProps {
  brand: "Ticket" | "Neat"
}

// Shown in the dashboard layout when organizations.payment_state = 'past_due'.
// Stripe Smart Retries will try the card a few more times before giving up;
// this banner nudges the owner to update their payment method in the Portal
// before that happens. Clicking the CTA POSTs to /api/stripe/portal and
// redirects the user into Stripe's hosted flow.
export function DunningBanner({ brand }: DunningBannerProps) {
  const [loading, setLoading] = useState(false)

  async function openPortal() {
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
    <div className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <p className="font-medium">
        Your last {brand} payment didn&rsquo;t go through. Update your payment
        method to keep your subscription active.
      </p>
      <button
        onClick={openPortal}
        disabled={loading}
        className="shrink-0 rounded-md bg-destructive px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {loading ? "Opening…" : "Update payment"}
      </button>
    </div>
  )
}
