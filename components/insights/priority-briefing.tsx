"use client"

import { useState } from "react"
import type { PriorityItem } from "@/lib/ai/prompts/priority-briefing"
import { SOURCE_COLORS, SOURCE_LABELS, type SourceCategory } from "@/lib/insights/scoring"

type Props = {
  priorities: PriorityItem[]
}

const URGENCY_STYLES = {
  critical: {
    border: "border-l-destructive",
    badge: "bg-destructive/15 text-destructive",
    icon: "text-destructive",
    bg: "from-destructive/10 to-card",
    ring: "ring-destructive/20",
  },
  warning: {
    border: "border-l-signal-gold",
    badge: "bg-signal-gold/15 text-signal-gold",
    icon: "text-signal-gold",
    bg: "from-signal-gold/10 to-card",
    ring: "ring-signal-gold/20",
  },
  info: {
    border: "border-l-precision-teal",
    badge: "bg-precision-teal/15 text-precision-teal",
    icon: "text-precision-teal",
    bg: "from-precision-teal/10 to-card",
    ring: "ring-precision-teal/20",
  },
} as const

const URGENCY_LABEL = {
  critical: "Urgent",
  warning: "This Week",
  info: "Plan Ahead",
} as const

function SourceBadge({ source }: { source: SourceCategory }) {
  const colors = SOURCE_COLORS[source]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
      {SOURCE_LABELS[source]}
    </span>
  )
}

function FeaturedPriorityCard({ item, rank }: { item: PriorityItem; rank: number }) {
  const style = URGENCY_STYLES[item.urgency]

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-l-4 ${style.border} bg-gradient-to-br ${style.bg} p-5 shadow-sm ring-1 ${style.ring}`}>
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-lg font-black text-foreground shadow-sm ring-1 ring-border">
          {rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>
              {URGENCY_LABEL[item.urgency]}
            </span>
            <SourceBadge source={item.source} />
          </div>

          <h3 className="mt-2 text-base font-bold leading-snug text-foreground">
            {item.title}
          </h3>

          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {item.why}
          </p>

          <div className="mt-3 flex items-start gap-2 rounded-xl bg-card/80 px-3.5 py-2.5 shadow-sm ring-1 ring-border/60">
            <svg className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <p className="text-xs font-medium leading-snug text-foreground">
              {item.action}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ExpandablePriorityCard({ item, rank }: { item: PriorityItem; rank: number }) {
  const [expanded, setExpanded] = useState(false)
  const style = URGENCY_STYLES[item.urgency]

  const whyIsLong = item.why.length > 120
  const actionIsLong = item.action.length > 100

  return (
    <div
      className={`relative rounded-xl border border-l-4 ${style.border} bg-gradient-to-br ${style.bg} p-4 shadow-sm ring-1 ${style.ring} transition hover:shadow-md`}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-card text-xs font-black text-foreground shadow-sm ring-1 ring-border">
          {rank}
        </div>
        <div className="flex items-center gap-1.5">
          <SourceBadge source={item.source} />
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>
            {URGENCY_LABEL[item.urgency]}
          </span>
        </div>
      </div>

      <h3 className="text-sm font-semibold leading-snug text-foreground">
        {item.title}
      </h3>

      <p className={`mt-1 text-xs leading-relaxed text-muted-foreground ${!expanded && whyIsLong ? "line-clamp-2" : ""}`}>
        {item.why}
      </p>

      <div className={`mt-2.5 flex items-start gap-1.5 rounded-lg bg-card/70 px-2.5 py-2 ring-1 ring-border/40`}>
        <svg className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${style.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        <p className={`text-[11px] font-medium leading-snug text-foreground ${!expanded && actionIsLong ? "line-clamp-2" : ""}`}>
          {item.action}
        </p>
      </div>

      {(whyIsLong || actionIsLong) && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-[11px] font-semibold text-primary hover:text-primary/80"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  )
}

export default function PriorityBriefing({ priorities }: Props) {
  if (priorities.length === 0) return null

  const [first, ...rest] = priorities

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-signal-gold/20 to-signal-gold/10">
          <svg className="h-4 w-4 text-signal-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-bold font-display text-foreground">Priority Briefing</h2>
          <p className="text-[11px] text-muted-foreground">AI-generated top priorities across all intelligence sources</p>
        </div>
      </div>

      <FeaturedPriorityCard item={first} rank={1} />

      {rest.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {rest.map((item, i) => (
            <ExpandablePriorityCard key={i} item={item} rank={i + 2} />
          ))}
        </div>
      )}
    </div>
  )
}

export function BriefingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-signal-gold/20" />
        <div className="space-y-1">
          <div className="h-4 w-28 rounded bg-muted" />
          <div className="h-3 w-56 rounded bg-muted" />
        </div>
      </div>

      <div className="rounded-2xl border border-l-4 border-l-border bg-gradient-to-br from-secondary to-card p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-muted" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex gap-2">
              <div className="h-5 w-16 rounded-full bg-muted" />
              <div className="h-5 w-14 rounded-full bg-muted" />
            </div>
            <div className="h-5 w-3/4 rounded bg-muted" />
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-10 w-full rounded-xl bg-muted" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-l-4 border-l-border bg-gradient-to-br from-secondary to-card p-4 shadow-sm">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="h-7 w-7 rounded-lg bg-muted" />
              <div className="flex gap-1.5">
                <div className="h-5 w-12 rounded-full bg-muted" />
                <div className="h-5 w-16 rounded-full bg-muted" />
              </div>
            </div>
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="mt-1.5 h-3 w-full rounded bg-muted" />
            <div className="mt-2.5 h-8 w-full rounded-lg bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
