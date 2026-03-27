"use client"

import { useState } from "react"
import Link from "next/link"

interface TrialBannerProps {
  daysRemaining: number
}

export function TrialBanner({ daysRemaining }: TrialBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const isUrgent = daysRemaining <= 3

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${
        isUrgent
          ? "bg-signal-gold/10 text-signal-gold"
          : "bg-precision-teal/10 text-precision-teal"
      }`}
    >
      <p className="font-medium">
        {daysRemaining} {daysRemaining === 1 ? "day" : "days"} left in your
        free trial.{" "}
        <Link
          href="/settings/billing"
          className="underline underline-offset-2 hover:no-underline"
        >
          Upgrade now
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
