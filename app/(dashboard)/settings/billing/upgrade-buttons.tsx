"use client"

import { useState } from "react"
import {
  PAID_TIERS,
  TIER_PRICING,
  getTierDisplayName,
  type Cadence,
  type SubscriptionTier,
} from "@/lib/billing/tiers"
import type { IndustryType } from "@/lib/verticals"

type PaidTier = Exclude<SubscriptionTier, "free" | "suspended">

interface UpgradeButtonsProps {
  industry: IndustryType
}

// Pricing card grid + monthly/annual toggle. Tier names come from
// lib/billing/tiers.ts (Table/Shift/House for Ticket; Well/Call/Top Shelf for
// Neat); prices from TIER_PRICING. Checkout posts {tier, cadence} to
// /api/stripe/checkout which resolves the Stripe price ID server-side using
// org.industry_type.
export function UpgradeButtons({ industry }: UpgradeButtonsProps) {
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
    <div className="space-y-5">
      <CadenceToggle cadence={cadence} onChange={setCadence} />

      <div className="grid gap-3 md:grid-cols-3">
        {PAID_TIERS.map((tier) => {
          const t = tier as PaidTier
          const pricing = TIER_PRICING[t]
          const displayName = getTierDisplayName(t, industry)
          const isRecommended = t === "mid"
          const offersTrial = t === "mid"
          const priceMain =
            cadence === "monthly"
              ? `$${pricing.monthly}/mo`
              : `$${pricing.annualEffectiveMonthly}/mo`
          const priceSub =
            cadence === "annual"
              ? `$${pricing.annual.toLocaleString()} billed annually (save 20%)`
              : "Billed monthly"

          return (
            <button
              key={t}
              onClick={() => handleUpgrade(t)}
              disabled={loading !== null}
              className={`rounded-lg border px-4 py-4 text-left transition-opacity hover:opacity-90 disabled:opacity-60 ${
                isRecommended
                  ? "border-vatic-indigo bg-vatic-indigo/5"
                  : "border-border bg-secondary"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{displayName}</p>
                {offersTrial && (
                  <span className="rounded-md bg-precision-teal/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-precision-teal">
                    14-day trial
                  </span>
                )}
              </div>
              <p className="mt-2 font-display text-[22px] font-semibold text-foreground">
                {priceMain}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{priceSub}</p>
              <p className="mt-2 text-xs font-medium text-precision-teal">
                {loading === t
                  ? "Redirecting…"
                  : offersTrial
                    ? "Start free trial"
                    : "Upgrade"}
              </p>
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
    <div className="flex items-center gap-2 text-xs">
      <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
        <button
          onClick={() => onChange("monthly")}
          className={`rounded-md px-3 py-1 font-medium ${
            cadence === "monthly"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground"
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => onChange("annual")}
          className={`rounded-md px-3 py-1 font-medium ${
            cadence === "annual"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground"
          }`}
        >
          Annual
        </button>
      </div>
      {cadence === "annual" && (
        <span className="rounded-md bg-precision-teal/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-precision-teal">
          Save 20%
        </span>
      )}
    </div>
  )
}
