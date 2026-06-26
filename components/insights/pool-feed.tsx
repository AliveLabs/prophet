"use client"

import { useMemo, useState } from "react"
import type { PoolEntry } from "@/lib/insights/insight-pool"

// Operator-facing category labels (kept in sync with brief-view.tsx CATEGORY_LABEL).
const CATEGORY_LABEL: Record<string, string> = {
  demand: "Demand",
  marketing: "Marketing",
  social: "Social",
  menu: "Menu",
  grassroots: "Grassroots",
  positioning: "Positioning",
  reputation: "Reputation",
  operations: "Operations",
  convergence: "Cross-domain",
}
const CONF_LABEL: Record<string, string> = { high: "High", medium: "Medium", directional: "Directional" }

function fmtDate(d: string): string {
  const dt = new Date(d + "T00:00:00")
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function PoolFeed({ entries }: { entries: PoolEntry[] }) {
  const [category, setCategory] = useState<string>("all")
  const [topOnly, setTopOnly] = useState<boolean>(false)

  // Category tabs: "All" + each category present in the pool, with counts.
  const tabs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) {
      if (!e.category) continue
      counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
    }
    return [{ key: "all", label: "All", count: entries.length }].concat(
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, label: CATEGORY_LABEL[key] ?? key, count })),
    )
  }, [entries])

  const shown = useMemo(() => {
    return entries.filter((e) => {
      if (topOnly && !e.is_top) return false
      if (category !== "all" && e.category !== category) return false
      return true
    })
  }, [entries, category, topOnly])

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No insights in your pool yet. As your briefs build over the coming days, every insight will
        accumulate here.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setCategory(t.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              category === t.key
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label} <span className="opacity-60">{t.count}</span>
          </button>
        ))}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={topOnly} onChange={(e) => setTopOnly(e.target.checked)} />
          This week&apos;s top only
        </label>
      </div>

      {/* Card list */}
      <ul className="space-y-3">
        {shown.map((e) => {
          const p = e.play
          return (
            <li key={e.id} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                {e.category && (
                  <span className="font-semibold text-foreground">{CATEGORY_LABEL[e.category] ?? e.category}</span>
                )}
                {e.confidence && <span>· {CONF_LABEL[e.confidence] ?? e.confidence} confidence</span>}
                {e.is_top && (
                  <span className="rounded-full bg-[var(--accent,#B85C38)]/10 px-2 py-0.5 font-semibold text-[var(--accent,#B85C38)]">
                    Top
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold leading-snug text-foreground">{p?.title ?? "Insight"}</h3>
              {p?.rationale && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.rationale}</p>}
              <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {e.first_seen_date === e.last_seen_date
                  ? `Seen ${fmtDate(e.last_seen_date)}`
                  : `First seen ${fmtDate(e.first_seen_date)} · last ${fmtDate(e.last_seen_date)}`}
              </div>
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="text-sm text-muted-foreground">No insights match this filter.</li>
        )}
      </ul>
    </div>
  )
}
