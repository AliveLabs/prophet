"use client"

// Pricing tiles + cadence toggle, rebuilt to The Pass premium pricing tiles.
// Same wired behavior as upgrade-buttons.tsx — checkout POSTs {tier, cadence} to
// /api/stripe/checkout (Stripe price ID resolved server-side from org.industry_type),
// recommended tier = mid, mid offers a 14-day trial. Feature bullets derive from
// TIER_LIMITS so they never drift from the enforced gates. Presentation only changes:
// kit tk-set-tier cards + segmented cadence toggle.

import { useState } from "react"
import {
  SELF_SERVE_TIERS,
  TIER_LIMITS,
  TIER_PRICING,
  getTierDisplayName,
  type Cadence,
  type SubscriptionTier,
} from "@/lib/billing/tiers"
import type { IndustryType } from "@/lib/verticals"
import { runCadenceLabel } from "@/lib/billing/limits"
import { classifyBillingResponse, GENERIC_BILLING_ERROR } from "@/lib/billing/checkout-errors"
import { ICON_CHECK } from "../settings-icons"
// Self-sufficient, same convention as components/first-run/*: pull the stylesheet the tiles need
// rather than depending on whichever surface mounts them. ALT-658 mounts this inside onboarding,
// which has no reason to know about the settings page. The .tk-set-* namespace is collision-safe
// by design (see the file header) and duplicate @imports dedupe.
import "../settings-pass.css"

type PaidTier = Exclude<SubscriptionTier, "suspended">

function tierFeatures(tier: PaidTier): string[] {
  const l = TIER_LIMITS[tier]
  const feats = [
    `${l.includedLocations} ${l.includedLocations === 1 ? "location" : "locations"}`,
    `${l.includedCompetitorsPerLocation} competitors per location`,
    runCadenceLabel(tier),
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
  context = "settings",
}: {
  industry: IndustryType
  showFeatures?: boolean
  /** ALT-658: "onboarding" makes Stripe return into the onboarding flow — forward to
   *  /onboarding/checkout-complete on purchase, back to /onboarding/trial on cancel. The
   *  checkout route already branches on this; the tiles just had no way to say so. */
  context?: "settings" | "onboarding"
}) {
  const [cadence, setCadence] = useState<Cadence>("monthly")
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ALT-551: every failure path used to end at `setLoading(null)` with nothing shown,
  // so a 403 or a 500 was indistinguishable from a dead button. Surface it.
  async function handleUpgrade(tier: PaidTier) {
    setError(null)
    setLoading(tier)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cadence, context }),
      })
      const payload = await res.json().catch(() => null)
      const outcome = classifyBillingResponse(res.ok, payload)
      if (outcome.kind === "redirect") {
        window.location.assign(outcome.url)
        return
      }
      setError(outcome.message)
      setLoading(null)
    } catch {
      setError(GENERIC_BILLING_ERROR)
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

      {error && (
        <span className="tk-set-status tk-set-status-err" role="alert">
          {error}
        </span>
      )}

      <div className="tk-set-tiers">
        {SELF_SERVE_TIERS.map((tier) => {
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
