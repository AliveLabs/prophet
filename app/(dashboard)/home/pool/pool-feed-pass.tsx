"use client"

// The Pass — the insight POOL feed, REBUILT to Concept A's kit.
//
// ALT-184 card parity: every pool card is now the SAME <PassPlayCard/> the daily
// brief renders — Keep/Dismiss (with reason capture), the 👍/👎 thumbs module,
// "See the play" detail drawer, and both confidence + impact scores, all wired
// through the same server actions (setPlayAction / submitPlayFeedback). Only the
// pool's page-level framing stays local: the category filter strip, the "Top this
// week" chip, and the recency stamp (carried into the shared card via extraChips).
//
// Kept (saved) insights pin to a "Pinned" section at the top (ALT-184g); everything
// else lists newest → oldest below it. Data is unchanged: the serialized PoolEntry[]
// from loadPoolEntries plus the latest per-play action map (loadLatestPlayActionsByKey),
// so a Keep here and a Keep on the brief are the same signal.

import { useMemo, useState, type CSSProperties } from "react"
import type { PoolEntry } from "@/lib/insights/insight-pool"
import type { PlayAction } from "@/lib/insights/momentum"
import {
  RevealOnView,
  TkSectionHead,
  TkEmptyState,
  TkToastProvider,
  tkcx,
} from "@/components/ticket"
import { PassPlayCard } from "../pass-play-card"

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

const TOP_CHIP = (
  <span className="pool-top-chip">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M5 16l-2-9 6 4 3-6 3 6 6-4-2 9z" />
    </svg>
    Top this week
  </span>
)

/** playKey → its latest action row (from loadLatestPlayActionsByKey). */
export type PoolActionMap = Record<string, { action: PlayAction; dateKey: string }>

export default function PoolFeedPass({
  entries,
  locationId,
  actions,
}: {
  entries: PoolEntry[]
  locationId: string
  actions: PoolActionMap
}) {
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

  // ALT-184g: kept (saved) insights pin to the top; everything else newest → oldest.
  const byRecency = (a: PoolEntry, b: PoolEntry) =>
    b.last_seen_date.localeCompare(a.last_seen_date) || b.combined_score - a.combined_score
  const pinned = useMemo(
    () => shown.filter((e) => actions[e.play_key]?.action === "saved").sort(byRecency),
    [shown, actions],
  )
  const rest = useMemo(
    () => shown.filter((e) => actions[e.play_key]?.action !== "saved").sort(byRecency),
    [shown, actions],
  )

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

  // ALT-184f: the SAME interactive card the brief uses — Keep/Dismiss + thumbs +
  // "See the play" drawer + confidence & impact. The action writes key against the
  // play's existing action row date (undo hits the right row) or, for an untouched
  // play, the date its brief last served it — the same (location, date, play)
  // contract the brief's own calls use. Icon-free per the icon-removal decision;
  // the pool's honest framing (top chip + recency) rides in via extraChips.
  const card = (e: PoolEntry, i: number) => {
    const row = actions[e.play_key]
    return (
      <div key={e.id} style={{ "--tk-i": Math.min(i, 12) } as CSSProperties}>
        <PassPlayCard
          play={e.play}
          rank={i + 1}
          isLead={false}
          locationId={locationId}
          dateKey={row?.dateKey ?? e.last_seen_date}
          playKey={e.play_key}
          current={row?.action ?? null}
          extraChips={
            <>
              {e.is_top ? TOP_CHIP : null}
              <span className="pool-seen">{recencyLabel(e)}</span>
            </>
          }
        />
      </div>
    )
  }

  return (
    <TkToastProvider>
      <div className="pool-feed">
        {/* ── FILTER STRIP (ALT-184c: the "top only" chip flows INLINE with the category
            tabs in one wrapping group, instead of being pushed onto its own row). ── */}
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
          </div>
        </RevealOnView>

        {shown.length ? (
          <>
            {/* ── PINNED (ALT-184g): the insights you kept, always first ── */}
            {pinned.length ? (
              <section className="pool-sec">
                <TkSectionHead
                  title="Pinned"
                  sub={`${pinned.length} insight${pinned.length === 1 ? "" : "s"} you kept`}
                />
                <RevealOnView className="tk-grid pool-grid" stagger>
                  {pinned.map(card)}
                </RevealOnView>
              </section>
            ) : null}

            {/* ── THE REST — newest first ── */}
            {rest.length ? (
              pinned.length ? (
                <section className="pool-sec">
                  <TkSectionHead title="Everything else" sub="Newest first" />
                  <RevealOnView className="tk-grid pool-grid" stagger>
                    {rest.map(card)}
                  </RevealOnView>
                </section>
              ) : (
                <RevealOnView className="tk-grid pool-grid" stagger>
                  {rest.map(card)}
                </RevealOnView>
              )
            ) : null}
          </>
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
    </TkToastProvider>
  )
}
