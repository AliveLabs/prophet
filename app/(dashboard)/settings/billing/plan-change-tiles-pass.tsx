"use client"

// ALT-228: in-app plan change for an EXISTING subscriber. Same tile styling as
// UpgradeTilesPass (upgrade-tiles-pass.tsx), but tiles call /api/stripe/change-plan
// in place instead of redirecting through Stripe Checkout, and the current
// tier+cadence renders as a locked "Current plan" tile instead of a CTA.

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  PAID_TIERS,
  TIER_LIMITS,
  TIER_PRICING,
  getTierDisplayName,
  type Cadence,
  type SubscriptionTier,
} from "@/lib/billing/tiers"
import type { IndustryType } from "@/lib/verticals"
import { ICON_CHECK } from "../settings-icons"

type PaidTier = Exclude<SubscriptionTier, "suspended">

function tierFeatures(tier: PaidTier): string[] {
  const l = TIER_LIMITS[tier]
  const feats = [
    `${l.maxLocations} ${l.maxLocations === 1 ? "location" : "locations"}`,
    `${l.maxCompetitorsPerLocation} competitors per location`,
    l.briefingCadence === "weekly_digest" ? "Weekly briefings" : "Daily briefings",
    l.ownSocialNetworkLimit === 1
      ? "1 social network of your choice + competitors on all 3"
      : `All ${l.ownSocialNetworkLimit} social networks`,
  ]
  if (l.whiteLabelReports) feats.push("White-label reports")
  if (l.apiAccess) feats.push("API access")
  return feats
}

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
  const [cadence, setCadence] = useState<Cadence>(currentCadence ?? "monthly")
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(tier: PaidTier) {
    setError(null)
    setLoading(tier)
    try {
      const res = await fetch("/api/stripe/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cadence }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to change plan")
        setLoading(null)
        return
      }
      router.refresh()
    } catch {
      setError("Failed to change plan")
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
        {cadence === "annual" && <span className="tk-set-save-note">Save 20%</span>}
      </div>

      {error && <span className="tk-set-status tk-set-status-err">{error}</span>}

      <div className="tk-set-tiers">
        {PAID_TIERS.map((tier) => {
          const t = tier as PaidTier
          const pricing = TIER_PRICING[t]
          const displayName = getTierDisplayName(t, industry)
          const isCurrent = t === currentTier && cadence === (currentCadence ?? cadence)
          const priceMain =
            cadence === "monthly" ? `$${pricing.monthly}` : `$${pricing.annualEffectiveMonthly}`
          const priceSub =
            cadence === "annual"
              ? `/mo · $${pricing.annual.toLocaleString()} billed annually · save 20%`
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
                {tierFeatures(t).map((f) => (
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
                      : PAID_TIERS.indexOf(t) > PAID_TIERS.indexOf(currentTier)
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
