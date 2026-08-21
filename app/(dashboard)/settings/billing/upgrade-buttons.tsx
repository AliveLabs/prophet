"use client"

import { useState } from "react"
import {
  SELF_SERVE_TIERS,
  TIER_PRICING,
  ANNUAL_SAVINGS_LABEL,
  ANNUAL_SAVINGS_INLINE,
  getTierDisplayName,
  isTrialEligibleTier,
  type Cadence,
  type SubscriptionTier,
} from "@/lib/billing/tiers"
import type { IndustryType } from "@/lib/verticals"
import { tierFeatureList } from "@/lib/billing/limits"
import { classifyBillingResponse, GENERIC_BILLING_ERROR } from "@/lib/billing/checkout-errors"

type PaidTier = Exclude<SubscriptionTier, "suspended">

interface UpgradeButtonsProps {
  industry: IndustryType
  /** Show the per-tier feature bullets (held/reactivation surface). The compact
   *  settings/billing grid leaves this off. */
  showFeatures?: boolean
}

// Pricing card grid + monthly/annual toggle. Tier names come from
// lib/billing/tiers.ts (Table/Shift/House for Ticket; Well/Call/Top Shelf for
// Neat); prices from TIER_PRICING. Checkout posts {tier, cadence} to
// /api/stripe/checkout which resolves the Stripe price ID server-side using
// org.industry_type.
export function UpgradeButtons({ industry, showFeatures = false }: UpgradeButtonsProps) {
  // ALT-699 — defaults to ANNUAL. It is the price we want people on, it is the cheaper option
  // for them, and the whole discount story (two months free) is invisible if the screen opens on
  // monthly. Not a dark pattern: the cheaper choice is pre-selected and the other is one tap away.
  const [cadence, setCadence] = useState<Cadence>("annual")
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ALT-551: this grid is the reactivation path on the held-account panel. A swallowed
  // checkout failure here reads as "the product is broken", so surface every failure.
  async function handleUpgrade(tier: PaidTier) {
    setError(null)
    setLoading(tier)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, cadence }),
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
      <CadenceToggle cadence={cadence} onChange={setCadence} />

      {error && (
        <div className="pv-field__hint" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      <div className="pv-tiers" style={{ marginTop: 14 }}>
        {/* ALT-735 — SELF_SERVE_TIERS, not PAID_TIERS. This grid is the held-account
            reactivation panel, so it is dashboard-wide and the highest-intent screen we have, and
            it was rendering Multi-Location as a one-click upgrade. Multi-Location is contract-only
            and priced PER LOCATION, so its list rate ($2,750/yr) sits BELOW Standard ($2,990/yr)
            while carrying strictly more entitlement. Both prices are live in Stripe, so the
            purchase completed. PAID_TIERS is for resolving contracts, never for offering one. */}
        {SELF_SERVE_TIERS.map((tier) => {
          const t = tier as PaidTier
          const pricing = TIER_PRICING[t]
          const displayName = getTierDisplayName(t, industry)
          const isRecommended = t === "mid"
          const offersTrial = isTrialEligibleTier(t)
          const priceMain =
            cadence === "monthly"
              ? `$${pricing.monthly}/mo`
              : `$${pricing.annualEffectiveMonthly}/mo`
          const priceSub =
            cadence === "annual"
              ? `$${pricing.annual.toLocaleString()} billed annually · ${ANNUAL_SAVINGS_INLINE}`
              : "Billed monthly"

          return (
            <button
              key={t}
              onClick={() => handleUpgrade(t)}
              disabled={loading !== null}
              className={`pv-tier${isRecommended ? " pv-tier--reco" : ""}`}
            >
              <div className="pv-tier__head">
                <span className="pv-tier__name">{displayName}</span>
                {offersTrial && (
                  <span className="pv-pill pv-pill--threat">14-day trial</span>
                )}
              </div>
              <div className="pv-tier__price">{priceMain}</div>
              <div className="pv-tier__sub">{priceSub}</div>
              {showFeatures && (
                <div className="pv-tier__features">
                  {tierFeatureList(t).map((f) => (
                    <span className="pv-tier__feat" key={f}>
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {f}
                    </span>
                  ))}
                </div>
              )}
              <div className="pv-tier__cta">
                {loading === t
                  ? "Redirecting…"
                  : offersTrial
                    ? "Start free trial →"
                    : "Upgrade →"}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CadenceToggle({
  cadence,
  onChange,
}: {
  cadence: Cadence
  onChange: (c: Cadence) => void
}) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div className="pv-cadence">
        <button
          type="button"
          onClick={() => onChange("monthly")}
          className={cadence === "monthly" ? "is-on" : ""}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => onChange("annual")}
          className={cadence === "annual" ? "is-on" : ""}
        >
          Annual
        </button>
      </div>
      {cadence === "annual" && <span className="pv-save-note">{ANNUAL_SAVINGS_LABEL}</span>}
    </div>
  )
}
