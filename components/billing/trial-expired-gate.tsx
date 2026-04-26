"use client"

import { useState } from "react"
import Link from "next/link"
import {
  PAID_TIERS,
  TIER_LIMITS,
  TIER_PRICING,
  getTierDisplayName,
  type Cadence,
  type SubscriptionTier,
} from "@/lib/billing/tiers"
import type { IndustryType } from "@/lib/verticals"
import { TicketLogo } from "@/components/brand/ticket-logo"

type PaidTier = Exclude<SubscriptionTier, "free" | "suspended">

interface TrialExpiredGateProps {
  orgName: string
  insightCount: number
  competitorCount: number
  brandName: "Ticket" | "Neat"
  industry: IndustryType
}

// Full-page gate rendered by the dashboard layout when an org has no active
// product access (trial expired on free tier, or Stripe subscription landed
// in canceled / incomplete_expired / unpaid). Lists the three paid tiers
// with per-brand names and a monthly/annual toggle. The mid tier shows a
// 14-day trial chip; the other two don't.
export function TrialExpiredGate({
  orgName,
  insightCount,
  competitorCount,
  brandName,
  industry,
}: TrialExpiredGateProps) {
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
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-3xl space-y-8 text-center">
        <div>
          {brandName === "Ticket" && (
            <TicketLogo size={48} className="mx-auto mb-4 text-foreground" />
          )}
          <h1 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
            Your {brandName} access is on hold
          </h1>
          <p className="mt-3 text-muted-foreground">
            {orgName}&rsquo;s subscription isn&rsquo;t currently active. Your
            data and insights are safely stored.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            So far, {brandName} generated{" "}
            <strong className="text-foreground">{insightCount} insights</strong>{" "}
            across{" "}
            <strong className="text-foreground">
              {competitorCount} competitors
            </strong>
            .
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            <button
              onClick={() => setCadence("monthly")}
              className={`rounded-md px-3 py-1 font-medium ${
                cadence === "monthly"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setCadence("annual")}
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

        <div className="grid gap-4 md:grid-cols-3">
          {PAID_TIERS.map((t) => {
            const tier = t as PaidTier
            const pricing = TIER_PRICING[tier]
            const limits = TIER_LIMITS[tier]
            const displayName = getTierDisplayName(tier, industry)
            const recommended = tier === "mid"
            const offersTrial = tier === "mid"
            const price =
              cadence === "monthly"
                ? `$${pricing.monthly}/mo`
                : `$${pricing.annualEffectiveMonthly}/mo`
            const priceSub =
              cadence === "annual"
                ? `$${pricing.annual.toLocaleString()} billed annually`
                : "Billed monthly"

            return (
              <div
                key={tier}
                className={`flex flex-col rounded-xl border p-5 text-left ${
                  recommended
                    ? "border-vatic-indigo shadow-[0_0_24px_rgba(90,63,255,0.15)]"
                    : "border-border"
                } bg-card`}
              >
                <div className="flex items-start justify-between gap-2">
                  {recommended ? (
                    <span className="inline-block rounded-md bg-vatic-indigo px-2 py-0.5 text-xs font-semibold text-white">
                      Recommended
                    </span>
                  ) : (
                    <span />
                  )}
                  {offersTrial && (
                    <span className="rounded-md bg-precision-teal/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-precision-teal">
                      14-day trial
                    </span>
                  )}
                </div>

                <h3 className="mt-2 text-lg font-semibold text-foreground">
                  {displayName}
                </h3>
                <p className="mt-1 font-display text-2xl font-semibold text-foreground">
                  {price}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{priceSub}</p>

                <ul className="mt-4 flex-1 space-y-2">
                  <Feature text={`${limits.maxLocations} ${limits.maxLocations === 1 ? "location" : "locations"}`} />
                  <Feature text={`${limits.maxCompetitorsPerLocation} competitors per location`} />
                  <Feature text={limits.briefingCadence === "weekly_digest" ? "Weekly briefings" : "Daily briefings"} />
                  <Feature text={`${limits.socialPlatforms.length} social platform${limits.socialPlatforms.length === 1 ? "" : "s"}`} />
                  {limits.whiteLabelReports && <Feature text="White-label reports" />}
                  {limits.apiAccess && <Feature text="API access" />}
                </ul>

                <button
                  onClick={() => handleUpgrade(tier)}
                  disabled={loading !== null}
                  className={`mt-4 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 ${
                    recommended
                      ? "bg-precision-teal text-white"
                      : "bg-secondary text-foreground"
                  }`}
                >
                  {loading === tier
                    ? "Redirecting…"
                    : offersTrial
                      ? `Start ${displayName} trial`
                      : `Subscribe to ${displayName}`}
                </button>
              </div>
            )
          })}
        </div>

        <p className="text-sm text-muted-foreground">
          Questions?{" "}
          <Link
            href="mailto:support@alivelabs.co"
            className="font-medium text-precision-teal hover:underline"
          >
            Contact us
          </Link>
        </p>
      </div>
    </div>
  )
}

function Feature({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        className="mt-0.5 shrink-0 text-precision-teal"
      >
        <path
          d="M3 8.5l3 3 7-7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {text}
    </li>
  )
}
