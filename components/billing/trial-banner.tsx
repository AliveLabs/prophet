"use client"

import { useEffect, useState } from "react"
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
   * When true, copy states the exact charge amount + date; when false (legacy
   * clock-only trial, no card on file) it asks for a card instead.
   */
  isPaidTrial?: boolean
  /** Monthly price (dollars) the card will be charged at conversion. */
  monthlyPrice?: number
  /** Human date the trial ends / the card is charged, e.g. "June 25". */
  endsOnLabel?: string
}

// The in-app side of the trial notification cadence (pairs with the day 10 +
// day 13 reminder emails): visible for the whole trial, escalating tone at
// T-4 (matches the day-10 email) and T-1 (matches day-13). Dismissal is
// remembered per remaining-day count, so each escalation re-surfaces it.
export function TrialBanner({
  daysRemaining,
  brandName = "Ticket",
  isPaidTrial = false,
  monthlyPrice,
  endsOnLabel,
}: TrialBannerProps) {
  const storageKey = `tk-trial-banner-dismissed:${daysRemaining}`
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(storageKey) !== "1")
    } catch {
      setVisible(true)
    }
  }, [storageKey])

  if (!visible) return null

  const dismiss = () => {
    setVisible(false)
    try {
      window.localStorage.setItem(storageKey, "1")
    } catch {
      // private mode — banner just reappears next load
    }
  }

  const dayWord = daysRemaining === 1 ? "day" : "days"
  const tone =
    daysRemaining <= 1
      ? "bg-destructive/10 text-destructive"
      : daysRemaining <= 4
        ? "bg-signal-gold/10 text-signal-gold"
        : "bg-precision-teal/10 text-precision-teal"

  const lead =
    daysRemaining <= 1
      ? `Your ${brandName} trial ends tomorrow`
      : `${daysRemaining} ${dayWord} left in your ${brandName} trial`

  const detail = isPaidTrial
    ? monthlyPrice && endsOnLabel
      ? ` — your card is charged $${monthlyPrice}/mo starting ${endsOnLabel}. Cancel anytime before then.`
      : " — your card will be charged when it ends. Cancel anytime before then."
    : " — there's no card on file, so add one to keep your briefs coming."

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${tone}`}
    >
      <p className="font-medium">
        {lead}
        {detail}{" "}
        <Link
          href="/settings/billing"
          className="underline underline-offset-2 hover:no-underline"
        >
          {isPaidTrial ? "Manage billing" : "Choose a plan"}
        </Link>
      </p>
      <button
        onClick={dismiss}
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
