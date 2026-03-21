"use client"

import { useState } from "react"

interface FeedItem {
  id: string
  competitorName: string
  initials: string
  colorClass: string
  type: string
  typeBadge: string
  description: string
  distance?: string
  impact: "high" | "medium" | "low"
  recommendation?: string
  timeAgo: string
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  pricing: "bg-signal-gold/10 text-signal-gold",
  location: "bg-precision-teal/10 text-precision-teal",
  menu: "bg-primary/10 text-vatic-indigo-soft",
  promo: "bg-destructive/10 text-destructive",
  social: "bg-muted text-muted-foreground",
  review: "bg-signal-gold/10 text-signal-gold",
  visibility: "bg-primary/10 text-vatic-indigo-soft",
  weather: "bg-precision-teal/10 text-precision-teal",
  traffic: "bg-signal-gold/10 text-signal-gold",
}

const IMPACT_COLORS: Record<string, string> = {
  high: "text-destructive",
  medium: "text-signal-gold",
  low: "text-muted-foreground",
}

const COMP_ICON_COLORS = [
  "bg-primary/[0.18] text-vatic-indigo-soft",
  "bg-signal-gold/[0.15] text-signal-gold",
  "bg-precision-teal/[0.14] text-precision-teal",
  "bg-destructive/[0.13] text-destructive",
  "bg-muted-violet/[0.18] text-muted-violet",
]

const FILTER_TABS = ["All", "Pricing", "Menu", "Social", "Reviews", "Visibility"]

interface ActivityFeedProps {
  items: FeedItem[]
}

export default function ActivityFeed({ items }: ActivityFeedProps) {
  const [activeFilter, setActiveFilter] = useState("All")

  const filtered =
    activeFilter === "All"
      ? items
      : items.filter(
          (i) => i.type.toLowerCase() === activeFilter.toLowerCase()
        )

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
          <svg
            className="h-[13px] w-[13px] text-primary"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <circle cx="6.5" cy="6.5" r="5" />
            <path d="M6.5 3.5 L6.5 6.5 L8.5 8" />
          </svg>
          What Happened Near You
        </div>
        <div className="flex gap-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveFilter(tab)}
              className={`rounded-full border px-[10px] py-[3px] text-[11px] font-medium transition-colors ${
                activeFilter === tab
                  ? "border-primary/30 bg-primary/10 font-semibold text-primary"
                  : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-muted-foreground">
            No activity to show
          </div>
        ) : (
          filtered.map((item, idx) => (
            <article
              key={item.id}
              className="grid grid-cols-[38px_1fr_auto] gap-3 border-b border-border px-5 py-4 transition-colors hover:bg-secondary/20 last:border-b-0 max-md:grid-cols-[32px_1fr] max-md:px-4 max-md:py-3"
            >
              {/* Icon */}
              <div
                className={`mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg text-[12px] font-bold max-md:h-[30px] max-md:w-[30px] max-md:rounded-[7px] ${
                  item.colorClass || COMP_ICON_COLORS[idx % COMP_ICON_COLORS.length]
                }`}
              >
                {item.initials}
              </div>

              {/* Content */}
              <div>
                <div className="mb-[3px] flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {item.competitorName}
                  </span>
                  <span
                    className={`rounded px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.08em] ${
                      TYPE_BADGE_COLORS[item.type] ?? TYPE_BADGE_COLORS.social
                    }`}
                  >
                    {item.typeBadge}
                  </span>
                </div>
                <div
                  className="mb-[5px] text-[12.5px] leading-[1.5] text-muted-foreground max-md:text-[12px]"
                  dangerouslySetInnerHTML={{ __html: item.description }}
                />
                <div className="mb-[2px] flex items-center gap-3 text-[11px] text-muted-foreground">
                  {item.distance && <span>{item.distance}</span>}
                  <span
                    className={`flex items-center gap-[3px] font-semibold ${IMPACT_COLORS[item.impact]}`}
                  >
                    ● {item.impact.charAt(0).toUpperCase() + item.impact.slice(1)}{" "}
                    impact
                  </span>
                </div>

                {item.recommendation && (
                  <div className="mt-[7px] flex items-start gap-[7px] rounded-r-md border-l-2 border-precision-teal/45 bg-precision-teal/[0.065] px-[10px] py-[7px] text-[11.5px] leading-[1.45] text-foreground/70 max-md:text-[11px]">
                    <svg
                      className="mt-px shrink-0 text-precision-teal"
                      width="11"
                      height="11"
                      viewBox="0 0 11 11"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path
                        d="M5.5 1 L6.8 4.2 L10.2 4.5 L7.8 6.8 L8.5 10.2 L5.5 8.5 L2.5 10.2 L3.2 6.8 L0.8 4.5 L4.2 4.2 Z"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span dangerouslySetInnerHTML={{ __html: item.recommendation }} />
                  </div>
                )}
              </div>

              {/* Timestamp (hidden on mobile) */}
              <div className="whitespace-nowrap pt-1 text-[11px] text-muted-foreground max-md:hidden">
                {item.timeAgo}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  )
}
