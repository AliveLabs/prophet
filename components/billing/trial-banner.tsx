"use client"

import { useState } from "react"
import Link from "next/link"

interface TrialBannerProps {
  /**
   * Days until trial_ends_at. This value is read by the server layout from
   * `organizations.trial_ends_at` (Stripe-managed when payment_state='trialing',
   * platform-managed otherwise) — NOT computed from trial_started_at.
   */
  daysRemaining: number
  brandName?: "Ticket" | "Neat"
  /**
   * True when the trial is the Stripe-native mid-tier trial (payment_state='trialing').
   * When true, copy reminds users that card-on-file will be charged.
   */
  isPaidTrial?: boolean
}

export function TrialBanner({
  daysRemaining,
  brandName = "Ticket",
  isPaidTrial = false,
}: TrialBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const isUrgent = daysRemaining <= 3

  const label = isPaidTrial
    ? `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left in your ${brandName} trial — your card will be charged when it ends.`
    : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left in your ${brandName} free trial.`

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${
        isUrgent
          ? "bg-signal-gold/10 text-signal-gold"
          : "bg-precision-teal/10 text-precision-teal"
      }`}
    >
      <p className="font-medium">
        {label}{" "}
        <Link
          href="/settings/billing"
          className="underline underline-offset-2 hover:no-underline"
        >
          {isPaidTrial ? "Manage billing" : "Upgrade now"}
        </Link>
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  )
}
