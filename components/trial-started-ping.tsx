"use client"

import { useEffect } from "react"
import { fireMarketingConversionOnce } from "@/lib/analytics/marketing-tags"

// Fires the StartTrial conversion when a dashboard page loads with
// ?trial_started=1, then strips the flag from the URL so a copied link or
// bookmark never carries it. Both trial paths set the flag on their success
// redirect: the Stripe checkout return (onboarding/checkout-complete) already
// did, and the card-less path (startTrialWithoutCardAction) now does too.
// Reads window.location directly instead of useSearchParams so it needs no
// Suspense boundary and never affects server rendering.
export default function TrialStartedPing() {
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get("trial_started") !== "1") return
    fireMarketingConversionOnce("StartTrial")
    url.searchParams.delete("trial_started")
    window.history.replaceState(window.history.state, "", url.toString())
  }, [])

  return null
}
