"use client"

import { useState, useMemo } from "react"
import {
  SIGNAL_TYPE_CONFIG,
  mapInsightToCategory,
  type SignalCategory,
} from "@/lib/competitors/helpers"

type Signal = {
  id: string
  insight_type: string
  title: string
  summary: string
  severity: string
  date_key: string | null
}

const FILTER_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "seo", label: "SEO" },
  { key: "events", label: "Events" },
  { key: "reviews", label: "Reviews" },
  { key: "menu", label: "Menu" },
  { key: "photos", label: "Photos" },
  { key: "traffic", label: "Traffic" },
  { key: "social", label: "Social" },
]

function formatSignalDate(dateKey: string | null): string {
  if (!dateKey) return ""
  const d = new Date(dateKey + "T00:00:00")
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

export default function SignalTimeline({
  signals,
}: {
  signals: Signal[]
}) {
  const [filter, setFilter] = useState("all")

  const filtered = useMemo(() => {
    if (filter === "all") return signals
    return signals.filter(
      (s) => mapInsightToCategory(s.insight_type) === filter
    )
  }, [signals, filter])

  const now = new Date()
  const monthName = now.toLocaleDateString("en-US", { month: "long" })
  const thisMonthCount = signals.filter((s) => {
    if (!s.date_key) return false
    const d = new Date(s.date_key)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  return (
    <section className="mb-8">
      {/* Header */}
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-[22px] font-semibold text-foreground">
          Recent signals
        </h2>
        <span className="text-xs text-deep-violet">
          {thisMonthCount} this month
        </span>
      </div>

      {/* Filter tabs */}
      <div
        className="mb-5 flex gap-2 overflow-x-auto pb-0.5 scrollbar-none"
        role="tablist"
      >
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={filter === tab.key}
            onClick={() => setFilter(tab.key)}
            className={`shrink-0 rounded-full border-[1.5px] px-4 py-[7px] text-[13px] font-medium transition-all ${
              filter === tab.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Signal list */}
      <div className="flex flex-col">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No signals{filter !== "all" ? ` for ${filter}` : ""} yet
          </p>
        ) : (
          filtered.map((sig, i) => {
            const category = mapInsightToCategory(sig.insight_type)
            const config =
              SIGNAL_TYPE_CONFIG[category as SignalCategory]
            const isLast = i === filtered.length - 1

            return (
              <div
                key={sig.id}
                className="flex gap-3 border-b border-border py-4 last:border-b-0"
                style={{ animationDelay: `${i * 35}ms` }}
              >
                {/* Timeline gutter */}
                <div className="flex w-5 shrink-0 flex-col items-center pt-[3px]">
                  <div
                    className="h-[9px] w-[9px] shrink-0 rounded-full"
                    style={{
                      backgroundColor: config.color,
                      boxShadow: `0 0 0 3px color-mix(in srgb, ${config.color} 20%, transparent)`,
                    }}
                  />
                  {!isLast && (
                    <div className="mt-[5px] min-h-[18px] w-px flex-1 bg-border" />
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="mb-[3px] flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-deep-violet">
                      {formatSignalDate(sig.date_key)}
                    </span>
                    <span
                      className={`shrink-0 rounded-[10px] px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wider ${config.bgClass}`}
                    >
                      {config.label}
                    </span>
                  </div>
                  <p className="text-sm font-semibold leading-snug text-foreground">
                    {sig.title}
                  </p>
                  <p className="mt-[3px] text-[13px] leading-relaxed text-muted-foreground">
                    {sig.summary}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Month label */}
      {filtered.length > 0 && (
        <p className="mt-2 text-center text-[11px] text-deep-violet">
          Showing {filtered.length} signal{filtered.length !== 1 ? "s" : ""} ·{" "}
          {monthName}
        </p>
      )}
    </section>
  )
}
