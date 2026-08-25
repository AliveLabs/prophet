"use client"

import { useEffect } from "react"
import { fireMarketingConversionOnce } from "@/lib/analytics/marketing-tags"

// The onboarding surface is where a freshly created account lands, which
// makes its first view the closest browser-observable moment to "account
// created" (signup itself is a magic-link / OAuth round trip with no
// client-side success moment). Fired once per browser via localStorage, so
// wizard steps, refreshes, and the trial page remounting this layout do not
// re-fire it. An existing user revisiting /onboarding on a brand-new browser
// could count once; that noise is acceptable for ad optimization.
export default function RegistrationPing() {
  useEffect(() => {
    fireMarketingConversionOnce("CompleteRegistration")
  }, [])

  return null
}
