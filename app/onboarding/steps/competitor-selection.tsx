"use client"

import { useState, useMemo } from "react"
import type { OnboardingCandidate } from "../onboarding-wizard"

const CATEGORY_EMOJIS: Record<string, string> = {
  american: "🍔",
  italian: "🍕",
  mexican: "🌮",
  asian: "🥘",
  bar: "🍺",
  grill: "🍺",
  café: "☕",
  cafe: "☕",
  coffee: "☕",
  seafood: "🦞",
  pizza: "🍕",
  korean: "🥘",
  japanese: "🍣",
  chinese: "🥡",
  indian: "🍛",
  thai: "🍜",
  french: "🥐",
  mediterranean: "🫒",
  bakery: "🧁",
  default: "🍽️",
}

function getEmoji(category: string | null): string {
  if (!category) return CATEGORY_EMOJIS.default
  const lower = category.toLowerCase()
  for (const [key, emoji] of Object.entries(CATEGORY_EMOJIS)) {
    if (lower.includes(key)) return emoji
  }
  return CATEGORY_EMOJIS.default
}

function formatDistance(meters: unknown): string {
  const m = Number(meters)
  if (!Number.isFinite(m)) return ""
  const miles = m / 1609.34
  return `${miles.toFixed(1)} mi`
}

type CompetitorSelectionStepProps = {
  competitors: OnboardingCandidate[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  isLoading: boolean
  error: string | null
  onRetry: () => void
  locationCity: string | null
  brandName?: string
}

export default function CompetitorSelectionStep({
  competitors,
  selectedIds,
  onToggle,
  isLoading,
  error,
  onRetry,
  locationCity,
  brandName = "Vatic",
}: CompetitorSelectionStepProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return competitors
    const q = searchQuery.toLowerCase()
    return competitors.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q) ||
        c.address?.toLowerCase().includes(q)
    )
  }, [competitors, searchQuery])

  return (
    <section className="flex flex-col pt-10 pb-8 max-[540px]:pt-8">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-precision-teal mb-3">
        Your Competitors
      </div>
      <h2 className="font-display text-[32px] font-medium leading-[1.15] text-foreground mb-3 max-[540px]:text-[27px]">
        Who should
        <br />
        {brandName} watch?
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-6">
        {isLoading
          ? "Searching for nearby restaurants..."
          : competitors.length > 0
            ? "We found nearby restaurants. Pick up to 5 to track — you can always add more later."
            : "No competitors found yet."}
      </p>

      {/* Search */}
      {competitors.length > 0 && (
        <div className="relative mb-4">
          <svg
            className="absolute left-[13px] top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
          >
            <circle
              cx="6.5"
              cy="6.5"
              r="4.5"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M10 10l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for a specific restaurant…"
            autoComplete="off"
            className="w-full rounded-[10px] border border-border bg-card/40 pl-[38px] pr-4 py-[13px] text-[15px] text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-vatic-indigo/50 focus:ring-[3px] focus:ring-vatic-indigo/12"
          />
        </div>
      )}

      {/* Counter */}
      {competitors.length > 0 && (
        <div className="flex items-center justify-between py-3 border-b border-border/40 mb-4">
          <span className="text-xs text-muted-foreground">
            <strong className="text-vatic-indigo-soft font-semibold">
              {selectedIds.size}
            </strong>{" "}
            of 5 selected
          </span>
          {locationCity && (
            <span className="text-[11.5px] text-muted-foreground">
              Near {locationCity}
            </span>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="flex flex-col gap-3 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-[10px] border border-border/40 bg-card/20 p-[13px] animate-pulse"
            >
              <div className="w-10 h-10 rounded-md bg-border/40" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-32 rounded bg-border/40" />
                <div className="h-3 w-48 rounded bg-border/30" />
              </div>
              <div className="w-[22px] h-[22px] rounded-full border-[1.5px] border-border/40" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 mb-4">
          <p className="text-sm text-destructive">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-xs font-semibold text-destructive hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Competitor cards */}
      {!isLoading && (
        <div className="flex flex-col gap-3 mb-4">
          {filtered.map((c) => {
            const isOn = selectedIds.has(c.id)
            const meta = c.metadata as Record<string, unknown>
            const distance = formatDistance(meta?.distanceMeters)
            const rating = meta?.rating as number | undefined
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                className={`flex items-center gap-4 rounded-[10px] border p-[13px] text-left transition-all select-none max-[540px]:p-[11px] ${
                  isOn
                    ? "bg-vatic-indigo/8 border-vatic-indigo/30"
                    : "bg-card/30 border-border/60 hover:bg-card/50 hover:border-border"
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-lg transition-colors max-[540px]:h-9 max-[540px]:w-9 max-[540px]:text-base ${
                    isOn ? "bg-vatic-indigo/12" : "bg-card/50"
                  }`}
                >
                  {getEmoji(c.category)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate mb-0.5">
                    {c.name ?? "Unknown"}
                  </div>
                  <div className="flex items-center text-xs text-muted-foreground">
                    {distance && <span>{distance}</span>}
                    {distance && c.category && (
                      <span className="mx-1.5 opacity-40">·</span>
                    )}
                    {c.category && <span>{c.category}</span>}
                    {rating != null && (
                      <>
                        <span className="mx-1.5 opacity-40">·</span>
                        <span>⭐ {rating.toFixed(1)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div
                  className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all ${
                    isOn
                      ? "bg-vatic-indigo border-vatic-indigo"
                      : "border-border/60"
                  }`}
                >
                  {isOn && (
                    <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                      <path
                        d="M1 4.5L4 7.5L10 1"
                        stroke="white"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && competitors.length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No nearby competitors found. You can discover and add competitors later
          from your dashboard.
        </p>
      )}
    </section>
  )
}
