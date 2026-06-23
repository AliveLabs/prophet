"use client"

import { useCallback, useSyncExternalStore } from "react"
import Link from "next/link"

// Per-day dismissal flag in localStorage. SSR-safe: returns false (→ "visible")
// when window is unavailable or storage throws.
function readDismissed(storageKey: string): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(storageKey) === "1"
  } catch {
    return false
  }
}

// Same-tab pub/sub so dismiss() re-renders immediately (the native `storage`
// event only fires in OTHER tabs; cross-tab dismissals arrive via that event).
const listeners = new Set<() => void>()
function emitDismissChange() {
  for (const l of listeners) l()
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (typeof window !== "undefined") window.addEventListener("storage", cb)
  return () => {
    listeners.delete(cb)
    if (typeof window !== "undefined") window.removeEventListener("storage", cb)
  }
}

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
  // useSyncExternalStore is the SSR/hydration-safe way to read client-only state:
  // getServerSnapshot renders the banner visible during SSR + hydration, then
  // React reconciles to the real localStorage value with no hydration mismatch
  // (and no set-state-in-effect). Re-surfaces per escalation tier because the
  // storage key — and thus getSnapshot — is keyed on daysRemaining.
  const getSnapshot = useCallback(() => readDismissed(storageKey), [storageKey])
  const getServerSnapshot = useCallback(() => false, [])
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  if (dismissed) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey, "1")
    } catch {
      // private mode — banner just reappears next load
    }
    emitDismissChange()
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
