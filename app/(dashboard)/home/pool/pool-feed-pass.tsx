"use client"

// The Pass — the insight POOL feed, REBUILT to Concept A's kit.
//
// STRUCTURE rebuild (not a reskin): the old PoolFeed was pill-tabs over a vertical
// stack of bordered <li> rows. This re-authors the same data into a filter strip +
// a TkPlayCard GRID (icon, family chip, confidence pips, summary, "why we're
// confident" rolldown), with a "Top this week" chip, recency stamp, and real empty /
// filtered-empty states. It is a page-local component (lives in home/pool/) and does
// NOT touch the shared components/insights/pool-feed.tsx.
//
// Data is unchanged: it receives the serialized PoolEntry[] the server page already
// loads (loadPoolEntries) and the mapping is honest — %/estimated/"you vs competitor"
// language only, no POS/$/covers. The mapping helpers are the same SSOT the flagship
// brief uses (home/pass-map.ts), so the pool reads as the same product.

import { useMemo, useState, type CSSProperties } from "react"
import type { PoolEntry } from "@/lib/insights/insight-pool"
import {
  RevealOnView,
  TkPlayCard,
  TkChip,
  TkConfidence,
  TkWhy,
  TkEmptyState,
  tkcx,
} from "@/components/ticket"
import {
  playFamily,
  playChipLabel,
  confLevel,
  playWhyPoints,
  playWhySource,
} from "../pass-map"
import { FAMILY_ICON } from "../pass-icons"
import type { Confidence } from "@/lib/skills/types"

const CONF_SET = new Set<Confidence>(["high", "medium", "directional"])
// Prefer the row's stamped confidence, but only if it's a real level; otherwise fall
// back to the play's own confidence (always one of the three) so the pips never break.
function resolveConfidence(e: PoolEntry): Confidence {
  if (e.confidence && CONF_SET.has(e.confidence as Confidence)) return e.confidence as Confidence
  return e.play.confidence
}

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

function fmtDate(d: string): string {
  const dt = new Date(d + "T00:00:00")
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function recencyLabel(e: PoolEntry): string {
  return e.first_seen_date === e.last_seen_date
    ? `Seen ${fmtDate(e.last_seen_date)}`
    : `First seen ${fmtDate(e.first_seen_date)} · last ${fmtDate(e.last_seen_date)}`
}

const POOL_EMPTY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3 7l9-4 9 4-9 4-9-4z" />
    <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
  </svg>
)

export default function PoolFeedPass({ entries }: { entries: PoolEntry[] }) {
  const [category, setCategory] = useState<string>("all")
  const [topOnly, setTopOnly] = useState<boolean>(false)

  // Category filter chips: "All" + each category present, with counts (most common first).
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

  const topCount = useMemo(() => entries.filter((e) => e.is_top).length, [entries])

  const shown = useMemo(() => {
    return entries.filter((e) => {
      if (topOnly && !e.is_top) return false
      if (category !== "all" && e.category !== category) return false
      return true
    })
  }, [entries, category, topOnly])

  // ── First-run / never-built-a-brief: nothing has accumulated yet ──
  if (entries.length === 0) {
    return (
      <RevealOnView className="pool-empty-wrap">
        <TkEmptyState
          icon={POOL_EMPTY_ICON}
          title="Your pool is still filling in"
          description="As your briefs build over the coming days, every insight accumulates here — the top few surface on your brief each morning, the rest stay filterable by type."
        />
      </RevealOnView>
    )
  }

  return (
    <div className="pool-feed">
      {/* ── FILTER STRIP ── */}
      <RevealOnView className="pool-filters" as="div">
        <div className="pool-tabs" role="group" aria-label="Filter insights by type">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setCategory(t.key)}
              aria-pressed={category === t.key}
              className={tkcx("pool-tab", category === t.key && "pool-tab-on")}
            >
              {t.label}
              <span className="pool-tab-n">{t.count}</span>
            </button>
          ))}
        </div>
        {topCount > 0 ? (
          <button
            type="button"
            onClick={() => setTopOnly((v) => !v)}
            aria-pressed={topOnly}
            className={tkcx("pool-topfilter", topOnly && "pool-topfilter-on")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 9h12l-1.5 9h-9z" />
              <path d="M9 9V6a3 3 0 0 1 6 0v3" />
            </svg>
            This week&apos;s top only
          </button>
        ) : null}
      </RevealOnView>

      {/* ── INSIGHT GRID ── */}
      {shown.length ? (
        <RevealOnView className="tk-grid pool-grid" stagger>
          {shown.map((e, i) => {
            const play = e.play
            const family = playFamily(play)
            const level = confLevel(resolveConfidence(e))
            const whyPoints = playWhyPoints(play)
            const whySource = playWhySource(play)
            return (
              <div key={e.id} style={{ "--tk-i": Math.min(i, 12) } as CSSProperties}>
                <TkPlayCard
                  family={family}
                  icon={FAMILY_ICON[family]}
                  title={play?.title ?? "Insight"}
                  summary={play?.rationale}
                  // ONE product-wide confidence encoding (segmented pips) top-right — consistent
                  // with the brief. "Top this week" is a separate, honest chip below.
                  confidence={<TkConfidence level={level} />}
                  chips={
                    <>
                      <TkChip family={family}>{playChipLabel(play)}</TkChip>
                      {e.is_top ? (
                        <span className="pool-top-chip">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                            <path d="M5 16l-2-9 6 4 3-6 3 6 6-4-2 9z" />
                          </svg>
                          Top this week
                        </span>
                      ) : null}
                      <span className="pool-seen">{recencyLabel(e)}</span>
                    </>
                  }
                >
                  {whyPoints.length ? <TkWhy points={whyPoints} source={whySource} /> : null}
                </TkPlayCard>
              </div>
            )
          })}
        </RevealOnView>
      ) : (
        // ── Filtered-empty: matches no current filter ──
        <RevealOnView className="pool-empty-wrap">
          <TkEmptyState
            title="Nothing matches this filter"
            description="No insights in your pool match the current type or “top only” filter. Clear it to see everything."
            action={
              <button
                type="button"
                className="pool-clear"
                onClick={() => {
                  setCategory("all")
                  setTopOnly(false)
                }}
              >
                Clear filter
              </button>
            }
          />
        </RevealOnView>
      )}
    </div>
  )
}
