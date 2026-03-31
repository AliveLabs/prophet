"use client"

import { useState } from "react"

const TIERS = [
  { name: "Starter", tier: "starter", label: "3 locations, 15 competitors" },
  { name: "Pro", tier: "pro", label: "10 locations, 50 competitors", recommended: true },
  { name: "Agency", tier: "agency", label: "50 locations, 200 competitors" },
]

export function UpgradeButtons() {
  const [loading, setLoading] = useState<string | null>(null)

  async function handleUpgrade(tier: string) {
    setLoading(tier)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
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
    <div className="grid gap-3 md:grid-cols-3">
      {TIERS.map((t) => (
        <button
          key={t.tier}
          onClick={() => handleUpgrade(t.tier)}
          disabled={loading !== null}
          className={`rounded-lg border px-4 py-3 text-left transition-opacity hover:opacity-90 disabled:opacity-60 ${
            t.recommended
              ? "border-vatic-indigo bg-vatic-indigo/5"
              : "border-border bg-secondary"
          }`}
        >
          <p className="text-sm font-semibold text-foreground">{t.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.label}</p>
          <p className="mt-2 text-xs font-medium text-precision-teal">
            {loading === t.tier ? "Redirecting..." : "Upgrade"}
          </p>
        </button>
      ))}
    </div>
  )
}
