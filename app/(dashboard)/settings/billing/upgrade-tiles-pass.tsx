"use client"

// Pricing tiles + cadence toggle, rebuilt to The Pass premium pricing tiles.
// Same wired behavior as upgrade-buttons.tsx — checkout POSTs {tier, cadence} to
// /api/stripe/checkout (Stripe price ID resolved server-side from org.industry_type),
// recommended tier = mid, mid offers a 14-day trial. Feature bullets derive from
// TIER_LIMITS so they never drift from the enforced gates. Presentation only changes:
// kit tk-set-tier cards + segmented cadence toggle.

import { useState } from "react"
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

export function UpgradeTilesPass({
  industry,
  showFeatures = true,
}: {
  industry: IndustryType
  showFeatures?: boolean
}) {
  const [cadence, setCadence] = useState<Cadence>("monthly")
  const [loading, setLoading] = useState<string | null>(null)

  async function handleUpgrade(tier: PaidTier) {
    setLoading(tier)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cadence }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.assign(data.url)
      } else {
        setLoading(null)
      }
    } catch {
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

      <div className="tk-set-tiers">
        {PAID_TIERS.map((tier) => {
          const t = tier as PaidTier
          const pricing = TIER_PRICING[t]
          const displayName = getTierDisplayName(t, industry)
          const isRecommended = t === "mid"
          const offersTrial = t === "mid"
          const priceMain =
            cadence === "monthly"
              ? `$${pricing.monthly}`
              : `$${pricing.annualEffectiveMonthly}`
          const priceSub =
            cadence === "annual"
              ? `/mo · $${pricing.annual.toLocaleString()} billed annually · save 20%`
              : "/mo · billed monthly"

          return (
            <button
              key={t}
              type="button"
              onClick={() => handleUpgrade(t)}
              disabled={loading !== null}
              className={`tk-set-tier${isRecommended ? " tk-set-tier-reco" : ""}`}
            >
              {isRecommended && <span className="tk-set-tier-flag">Recommended</span>}
              <div className="tk-set-tier-head">
                <span className="tk-set-tier-name">{displayName}</span>
                {offersTrial && <span className="tk-set-tier-trial">14-day trial</span>}
              </div>
              <div className="tk-set-tier-price">{priceMain}</div>
              <div className="tk-set-tier-sub">{priceSub}</div>
              {showFeatures && (
                <div className="tk-set-tier-feats">
                  {tierFeatures(t).map((f) => (
                    <span className="tk-set-tier-feat" key={f}>
                      {ICON_CHECK}
                      {f}
                    </span>
                  ))}
                </div>
              )}
              <span className="tk-set-tier-cta">
                {loading === t
                  ? "Redirecting…"
                  : offersTrial
                    ? "Start free trial →"
                    : "Upgrade →"}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
