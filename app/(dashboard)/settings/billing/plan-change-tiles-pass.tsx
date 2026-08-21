"use client"

// ALT-228: in-app plan change for an EXISTING subscriber. Same tile styling as
// UpgradeTilesPass (upgrade-tiles-pass.tsx), but tiles call /api/stripe/change-plan
// in place instead of redirecting through Stripe Checkout, and the current
// tier+cadence renders as a locked "Current plan" tile instead of a CTA.

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  SELF_SERVE_TIERS,
  TIER_PRICING,
  ANNUAL_SAVINGS_LABEL,
  ANNUAL_SAVINGS_INLINE,
  getTierDisplayName,
  type Cadence,
  type SubscriptionTier,
} from "@/lib/billing/tiers"
import type { IndustryType } from "@/lib/verticals"
import { tierFeatureList } from "@/lib/billing/limits"
import { classifyBillingMutation, GENERIC_BILLING_ERROR } from "@/lib/billing/checkout-errors"
import { ICON_CHECK } from "../settings-icons"

type PaidTier = Exclude<SubscriptionTier, "suspended">

export function PlanChangeTilesPass({
  industry,
  currentTier,
  currentCadence,
}: {
  industry: IndustryType
  currentTier: PaidTier
  /** Null when we couldn't resolve a cadence from the stored price ID — the
   *  current tile still locks correctly, just without a cadence toggle default. */
  currentCadence: Cadence | null
}) {
  const router = useRouter()
  // Keeps the customer's CURRENT cadence. Unlike the sell surfaces this is a change screen, and
  // pre-selecting a switch nobody asked for is a different thing from showing the better offer.
  const [cadence, setCadence] = useState<Cadence>(currentCadence ?? "annual")
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ALT-551: a non-JSON error response (an HTML 500 page) used to throw inside
  // res.json(), land in the bare catch, and show "Failed to change plan" with no
  // detail. Parse defensively and pass the route's own message through.
  async function handleChange(tier: PaidTier) {
    setError(null)
    setLoading(tier)
    try {
      const res = await fetch("/api/stripe/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cadence }),
      })
      const payload = await res.json().catch(() => null)
      const outcome = classifyBillingMutation(res.ok, payload)
      if (outcome.kind === "error") {
        setError(outcome.message)
        return
      }
      router.refresh()
    } catch {
      setError(GENERIC_BILLING_ERROR)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div>
      <div className="tk-set-cadence">
        <div className="tk-set-cadence-seg" role="tablist" aria-label="Billing cadence">
          <button
            type="button"
            role="tab"
            aria-selected={cadence === "monthly"}
            onClick={() => setCadence("monthly")}
            className={cadence === "monthly" ? "tk-on" : ""}
          >
            Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={cadence === "annual"}
            onClick={() => setCadence("annual")}
            className={cadence === "annual" ? "tk-on" : ""}
          >
            Annual
          </button>
        </div>
        {cadence === "annual" && <span className="tk-set-save-note">{ANNUAL_SAVINGS_LABEL}</span>}
      </div>

      {error && <span className="tk-set-status tk-set-status-err">{error}</span>}

      <div className="tk-set-tiers">
        {SELF_SERVE_TIERS.map((tier) => {
          const t = tier as PaidTier
          const pricing = TIER_PRICING[t]
          const displayName = getTierDisplayName(t, industry)
          const isCurrent = t === currentTier && cadence === (currentCadence ?? cadence)
          const priceMain =
            cadence === "monthly" ? `$${pricing.monthly}` : `$${pricing.annualEffectiveMonthly}`
          const priceSub =
            cadence === "annual"
              ? `/mo · $${pricing.annual.toLocaleString()} billed annually · ${ANNUAL_SAVINGS_INLINE}`
              : "/mo · billed monthly"

          return (
            <button
              key={t}
              type="button"
              onClick={() => handleChange(t)}
              disabled={loading !== null || isCurrent}
              className={`tk-set-tier${t === currentTier ? " tk-set-tier-reco" : ""}`}
            >
              {t === currentTier && <span className="tk-set-tier-flag">Current tier</span>}
              <div className="tk-set-tier-head">
                <span className="tk-set-tier-name">{displayName}</span>
              </div>
              <div className="tk-set-tier-price">{priceMain}</div>
              <div className="tk-set-tier-sub">{priceSub}</div>
              <div className="tk-set-tier-feats">
                {tierFeatureList(t).map((f) => (
                  <span className="tk-set-tier-feat" key={f}>
                    {ICON_CHECK}
                    {f}
                  </span>
                ))}
              </div>
              <span className="tk-set-tier-cta">
                {isCurrent
                  ? "Current plan"
                  : loading === t
                    ? "Changing…"
                    : t === currentTier
                      ? cadence === "annual"
                        ? "Switch to annual →"
                        : "Switch to monthly →"
                      : SELF_SERVE_TIERS.indexOf(t) > SELF_SERVE_TIERS.indexOf(currentTier)
                        ? "Upgrade →"
                        : "Downgrade →"}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
