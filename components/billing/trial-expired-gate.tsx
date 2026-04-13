"use client"

import { useState } from "react"
import Link from "next/link"

interface TrialExpiredGateProps {
  orgName: string
  insightCount: number
  competitorCount: number
}

const TIERS = [
  {
    name: "Starter",
    priceEnv: "NEXT_PUBLIC_STRIPE_PRICE_ID_STARTER",
    features: [
      "3 locations",
      "15 competitors per location",
      "Weekly intelligence refresh",
    ],
  },
  {
    name: "Pro",
    priceEnv: "NEXT_PUBLIC_STRIPE_PRICE_ID_PRO",
    features: [
      "10 locations",
      "50 competitors per location",
      "Daily intelligence refresh",
      "All signals",
    ],
    recommended: true,
  },
  {
    name: "Agency",
    priceEnv: "NEXT_PUBLIC_STRIPE_PRICE_ID_AGENCY",
    features: [
      "50 locations",
      "200 competitors per location",
      "Priority processing",
      "White-label ready",
    ],
  },
]

export function TrialExpiredGate({
  orgName,
  insightCount,
  competitorCount,
}: TrialExpiredGateProps) {
  const [loading, setLoading] = useState<string | null>(null)

  async function handleUpgrade(tierName: string) {
    setLoading(tierName)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierName.toLowerCase() }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.assign(data.url)
      }
    } catch {
      setLoading(null)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-3xl space-y-8 text-center">
        <div>
          <svg
            width="40"
            height="40"
            viewBox="0 0 80 80"
            fill="none"
            className="mx-auto mb-4"
          >
            <path
              d="M10 14 L40 66 L70 14"
              stroke="var(--vatic-indigo)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="40" cy="66" r="6" fill="var(--signal-gold)" />
          </svg>
          <h1 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
            Your free trial has ended
          </h1>
          <p className="mt-3 text-muted-foreground">
            {orgName}&rsquo;s trial period has expired. Your data and insights
            are safely stored.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            During your trial, Vatic generated{" "}
            <strong className="text-foreground">{insightCount} insights</strong>{" "}
            across{" "}
            <strong className="text-foreground">
              {competitorCount} competitors
            </strong>
            .
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`flex flex-col rounded-xl border p-5 ${
                tier.recommended
                  ? "border-vatic-indigo shadow-[0_0_24px_rgba(90,63,255,0.15)]"
                  : "border-border"
              } bg-card`}
            >
              {tier.recommended && (
                <span className="mb-2 inline-block self-start rounded-md bg-vatic-indigo px-2 py-0.5 text-xs font-semibold text-white">
                  Recommended
                </span>
              )}
              <h3 className="text-lg font-semibold text-foreground">
                {tier.name}
              </h3>
              <ul className="mt-3 flex-1 space-y-2 text-left">
                {tier.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
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
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleUpgrade(tier.name)}
                disabled={loading !== null}
                className={`mt-4 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 ${
                  tier.recommended
                    ? "bg-precision-teal text-white"
                    : "bg-secondary text-foreground"
                }`}
              >
                {loading === tier.name ? "Redirecting..." : `Upgrade to ${tier.name}`}
              </button>
            </div>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          Questions?{" "}
          <Link
            href="mailto:support@vatic.com"
            className="font-medium text-precision-teal hover:underline"
          >
            Contact us
          </Link>
        </p>
      </div>
    </div>
  )
}
