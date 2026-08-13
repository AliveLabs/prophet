"use client"

// The all-insights view's client island: two sections, batch reveal, one card.
//
// Deliberately thin — the server page owns the data, the split and the ordering; the two
// wiring islands (<BriefInsightCard/> for plays, <InsightRowCard/> for detector rows) own
// the writes; this file owns only how many cards each section has revealed so far.
// The reveal is the same one-batch-per-click planner /insights ships (ALT-292), which is
// what replaces the old pool page's single uncapped list.

import { useState, useCallback, type CSSProperties } from "react"
import { RevealOnView, TkSectionHead, TkEmptyState, TkToastProvider } from "@/components/ticket"
import { BriefInsightCard } from "@/app/(dashboard)/home/brief-insight-card"
import type { PoolEntry } from "@/lib/insights/insight-pool"
import type { PlayAction } from "@/lib/insights/momentum"
import { InsightRowCard } from "../insight-row-card"
import { RevealFooter, type FeedInsight } from "../insights-feed-kit"
import { revealPlan } from "../insights-reveal"

const BATCH = 6

export type PlanItem = {
  entry: PoolEntry
  /** The date the play's action row (or its serving brief) keys against. */
  dateKey: string
  current: PlayAction | null
}

export type ObservationItem =
  | { kind: "play"; item: PlanItem }
  | { kind: "row"; row: FeedInsight }

const EMPTY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3 7l9-4 9 4-9 4-9-4z" />
    <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
  </svg>
)

function PlanCard({ item, locationId }: { item: PlanItem; locationId: string }) {
  return (
    <BriefInsightCard
      play={item.entry.play}
      isLead={false}
      locationId={locationId}
      dateKey={item.dateKey}
      playKey={item.entry.play_key}
      current={item.current}
      stateLabel={item.entry.is_top ? "Top this week" : undefined}
    />
  )
}

export default function AllInsightsFeed({
  planItems,
  observations,
  locationId,
}: {
  planItems: PlanItem[]
  observations: ObservationItem[]
  locationId: string
}) {
  // How many cards each section shows; one batch per click, "Show less" resets.
  const [shownCounts, setShownCounts] = useState<Record<string, number>>({})
  const shownFor = (key: string, total: number) => Math.min(shownCounts[key] ?? BATCH, total)
  const revealMore = useCallback((key: string, max: number) => {
    setShownCounts((prev) => ({ ...prev, [key]: Math.min((prev[key] ?? BATCH) + BATCH, max) }))
  }, [])
  const collapse = useCallback((key: string) => {
    setShownCounts((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  // ALT-184g's optimistic re-bucketing is deliberately absent here: every card's own
  // action already router.refresh()es, and the server owns this page's ordering.
  const planShown = shownFor("plan", planItems.length)
  const planPlan = revealPlan({ shown: planShown, recentCount: 0, total: planItems.length, batch: BATCH })
  const obsShown = shownFor("obs", observations.length)
  const obsPlan = revealPlan({ shown: obsShown, recentCount: 0, total: observations.length, batch: BATCH })

  if (planItems.length === 0 && observations.length === 0) {
    return (
      <RevealOnView className="ins-all-empty">
        <TkEmptyState
          icon={EMPTY_ICON}
          title="This is still filling in"
          description="As your briefs build over the coming days, every insight collects here. The top few surface on your brief each morning; the rest wait here."
        />
      </RevealOnView>
    )
  }

  return (
    <TkToastProvider>
      <div className="ins-all">
        {planItems.length ? (
          <section className="ins-all-sec">
            <TkSectionHead
              title="Ready to act on"
              sub={`Each of these comes with a step-by-step plan. ${planItems.length} in all, kept ones first.`}
            />
            <RevealOnView className="tk-grid ins-grid" stagger>
              {planItems.slice(0, planShown).map((item, i) => (
                <div key={item.entry.id} style={{ "--tk-i": Math.min(i, 12) } as CSSProperties}>
                  <PlanCard item={item} locationId={locationId} />
                </div>
              ))}
            </RevealOnView>
            <RevealFooter
              plan={planPlan}
              onMore={() => revealMore("plan", planItems.length)}
              onCollapse={planShown > BATCH ? () => collapse("plan") : null}
            />
          </section>
        ) : null}

        {observations.length ? (
          <section className="ins-all-sec">
            <TkSectionHead
              title="Observations"
              sub="We spotted these. There is no plan behind them yet."
            />
            <RevealOnView className="tk-grid ins-grid" stagger>
              {observations.slice(0, obsShown).map((o, i) => (
                <div
                  key={o.kind === "play" ? `play:${o.item.entry.id}` : `row:${o.row.id}`}
                  style={{ "--tk-i": Math.min(i, 12) } as CSSProperties}
                >
                  {o.kind === "play" ? (
                    <PlanCard item={o.item} locationId={locationId} />
                  ) : (
                    <InsightRowCard insight={o.row} />
                  )}
                </div>
              ))}
            </RevealOnView>
            <RevealFooter
              plan={obsPlan}
              onMore={() => revealMore("obs", observations.length)}
              onCollapse={obsShown > BATCH ? () => collapse("obs") : null}
            />
          </section>
        ) : null}
      </div>
    </TkToastProvider>
  )
}
