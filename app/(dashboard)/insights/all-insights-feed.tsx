"use client"

// The /insights client island: two sections, batch reveal, one card.
//
// Deliberately thin — the server page owns the data, the filtering, the split and the
// ordering; the two wiring islands (<BriefInsightCard/> for plays, <InsightRowCard/> for
// detector rows) own the writes; this file owns only how many cards each section has
// revealed so far, plus the ALT-230 generate flow (a viz card's "Generate insight" lands
// here as ?generate=<json viz ctx>).
// The reveal is the ALT-292 one-batch-per-click planner, which is what replaced the old
// pool page's single uncapped list.

import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react"
import { RevealOnView, TkSectionHead, TkEmptyState, TkToastProvider } from "@/components/ticket"
import { BriefInsightCard } from "@/app/(dashboard)/home/brief-insight-card"
import type { PoolEntry } from "@/lib/insights/insight-pool"
import type { PlayAction } from "@/lib/insights/momentum"
import { InsightRowCard } from "./insight-row-card"
import type { FeedInsight } from "./insights-map"
import { revealPlan, type RevealPlan } from "./insights-reveal"

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

/** ALT-292: the reveal footer both sections share. One batch per click (never the whole
 *  remainder), an honest count of what is still unloaded, and a way back to the default
 *  view once the operator has expanded past it. Lived in the retired insights-feed-kit. */
function RevealFooter({
  plan: { nextCount, remaining },
  onMore,
  onCollapse,
}: {
  plan: RevealPlan
  onMore: () => void
  onCollapse: (() => void) | null
}) {
  if (remaining <= 0 && !onCollapse) return null
  return (
    <div className="ins-morerow">
      {remaining > 0 ? (
        <button type="button" className="ins-more" onClick={onMore}>
          Show {nextCount} more
          <span className="ins-more-n">{remaining} left</span>
        </button>
      ) : null}
      {onCollapse ? (
        <button type="button" className="ins-less" onClick={onCollapse}>
          Show less
        </button>
      ) : null}
    </div>
  )
}

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
  planTotal,
  obsTotal,
  hasFilters,
  locationId,
  generateRequest,
}: {
  planItems: PlanItem[]
  observations: ObservationItem[]
  /** Unfiltered totals, so a filtered sub can say "N of M" honestly. */
  planTotal: number
  obsTotal: number
  hasFilters: boolean
  locationId: string
  /** ALT-230: the raw `?generate=<json viz ctx>` string. When present we POST it to
   *  the generate endpoint, show a spinner at the top, then pin the resulting insight
   *  there with a "Just generated" marker. */
  generateRequest?: string | null
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

  // ── ALT-230: live "Generate insight" from a viz card. We POST the carried-in viz
  //    context once, show a placeholder at the top, then pin the result. ──
  const [generating, setGenerating] = useState<boolean>(!!generateRequest)
  const [generated, setGenerated] = useState<FeedInsight | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const startedFor = useRef<string | null>(null) // the viz-context string we kicked off

  // The fetch itself. ONLY async-callback setState lives here (no synchronous setState),
  // so calling it from the effect doesn't trip react-hooks/set-state-in-effect. The
  // pre-request resets (spinner on, clear prior error/result) are done by the caller:
  // init state covers the first auto-run; the retry button (an event handler) does them.
  const runFetch = useCallback((reqStr: string) => {
    fetch("/api/ai/insights/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vizContext: reqStr }),
    })
      .then(async (r) => {
        const data = (await r.json().catch(() => null)) as { insight: FeedInsight | null } | null
        return { status: r.status, insight: data?.insight ?? null }
      })
      .then(({ status, insight }) => {
        if (insight?.id) {
          setGenerated({ ...insight, justGenerated: true })
          return
        }
        // Tell the operator what actually happened instead of one catch-all that hides a
        // rate-limit or permission issue (ALT-294). Plain voice, no em dashes.
        setGenError(
          status === 429
            ? "You’re generating a lot right now. Give it a minute and try again."
            : status === 403
              ? "You don’t have permission to generate insights on this account."
              : "We couldn’t generate that just now. Try again in a moment.",
        )
      })
      .catch(() => setGenError("We couldn’t generate that just now. Try again in a moment."))
      .finally(() => setGenerating(false))
  }, [])

  // Retry from the inline error (event handler — free to setState synchronously).
  const retryGenerate = useCallback(
    (reqStr: string) => {
      setGenerating(true)
      setGenError(null)
      setGenerated(null)
      runFetch(reqStr)
    },
    [runFetch],
  )

  useEffect(() => {
    // Re-fire only when the REQUESTED viz changes (not a one-shot bool): a different viz
    // card re-generates, while StrictMode / re-renders with the same request don't. The
    // spinner is already on via the `generating` init, so no synchronous setState here.
    if (!generateRequest || startedFor.current === generateRequest) return
    startedFor.current = generateRequest
    runFetch(generateRequest)
    // Strip ?generate= so a manual refresh never re-triggers a paid generation. History
    // API (NOT router.replace) avoids refetching the server tree — which, post-updateTag,
    // would render the new row twice (pinned + in Observations) and yank the pin away.
    // The pin persists for THIS session; the row settles into its honest rank on the
    // user's next deliberate refresh.
    if (typeof window !== "undefined") window.history.replaceState(null, "", "/insights")
  }, [generateRequest, runFetch])

  // Only pin the generated card while it isn't yet in the server feed. Once a refresh
  // (e.g. a status action's router.refresh, or a later navigation) pulls it in, it shows
  // in Observations at its honest rank instead — never both at once (ALT-230).
  const pinnedGenerated = useMemo(
    () =>
      generated && !observations.some((o) => o.kind === "row" && o.row.id === generated.id)
        ? generated
        : null,
    [generated, observations],
  )

  // ALT-184g's optimistic re-bucketing is deliberately absent here: every card's own
  // action already router.refresh()es, and the server owns this page's ordering.
  const planShown = shownFor("plan", planItems.length)
  const planPlan = revealPlan({ shown: planShown, recentCount: 0, total: planItems.length, batch: BATCH })
  const obsShown = shownFor("obs", observations.length)
  const obsPlan = revealPlan({ shown: obsShown, recentCount: 0, total: observations.length, batch: BATCH })

  // A section renders while it has cards, or while a filter (not an empty account) is
  // what emptied it — then it stays, labelled, so the narrowing is honest.
  const showPlanSection = planItems.length > 0 || (hasFilters && planTotal > 0)
  const showObsSection = observations.length > 0 || (hasFilters && obsTotal > 0)
  const generateBusy = generating || Boolean(pinnedGenerated)

  const planSub = hasFilters
    ? planItems.length
      ? `Showing ${planItems.length} of ${planTotal}, kept ones first.`
      : undefined
    : `Each of these comes with a step-by-step plan. ${planItems.length} in all, kept ones first.`
  const obsSub = hasFilters
    ? observations.length
      ? `Showing ${observations.length} of ${obsTotal}.`
      : undefined
    : "We spotted these. There is no plan behind them yet."

  return (
    <TkToastProvider>
      <div className="ins-all">
        {/* ── ALT-230: a live-generated insight, pinned to the very top of the page.
            Shows a shimmer placeholder while generating, then the card with a "Just
            generated" marker. It is display-only here — on a later refresh it settles
            into its honest, low-scored rank within Observations. ── */}
        {generating && !generated ? (
          <div className="ins-gen-pending" aria-live="polite">
            <div className="ins-gen-skel tk-sweep" aria-hidden="true" />
            <span className="ins-gen-note">Generating your insight…</span>
          </div>
        ) : null}
        {pinnedGenerated ? (
          <div className="ins-gen-landed">
            <InsightRowCard insight={pinnedGenerated} />
          </div>
        ) : null}
        {genError && !generating ? (
          <div className="ins-error ins-gen-error" role="alert">
            <span>{genError}</span>
            {generateRequest ? (
              <button type="button" className="ins-gen-retry" onClick={() => retryGenerate(generateRequest)}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {showPlanSection ? (
          <section className="ins-all-sec">
            <TkSectionHead title="Ready to act on" sub={planSub} />
            {planItems.length ? (
              <>
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
              </>
            ) : (
              <p className="ins-sec-empty">
                No ready-to-act insights match these filters. Clearing a filter brings back{" "}
                {planTotal === 1 ? "the one waiting here" : `all ${planTotal}`}.
              </p>
            )}
          </section>
        ) : null}

        {showObsSection ? (
          <section className="ins-all-sec">
            <TkSectionHead title="Observations" sub={obsSub} />
            {observations.length ? (
              <>
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
              </>
            ) : (
              <p className="ins-sec-empty">
                No observations match these filters. Clearing a filter brings back{" "}
                {obsTotal === 1 ? "the one waiting here" : `all ${obsTotal}`}.
              </p>
            )}
          </section>
        ) : null}

        {/* ── Page-empty states. A filter that empties a section leaves the section
            rendered with a labelled note above, so landing here means the DEFAULT view
            has nothing: either the account is still filling in, or the operator has
            cleared everything that exists (an honest, different message — the cleared
            items are one status switch away). Suppressed while a generation is in
            flight or has just landed, so the pinned card/placeholder owns the top. ── */}
        {!showPlanSection && !showObsSection && !generateBusy ? (
          <RevealOnView className="ins-all-empty">
            {planTotal + obsTotal > 0 ? (
              <TkEmptyState
                icon={EMPTY_ICON}
                title="All caught up"
                description="Everything here has been dismissed or reported. Switch the status filter to Dismissed or Reported inaccurate to review it, or wait for the next sweep to bring new insights."
              />
            ) : (
              <TkEmptyState
                icon={EMPTY_ICON}
                title="This is still filling in"
                description="As your briefs build over the coming days, every insight collects here. The top few surface on your brief each morning; the rest wait here."
              />
            )}
          </RevealOnView>
        ) : null}
      </div>
    </TkToastProvider>
  )
}
