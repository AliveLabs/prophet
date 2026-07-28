"use client"

// The Pass — the /insights feed, REBUILT to the kit.
//
// This REPLACES the shared <InsightFeed/> presentation (we may not edit the
// shared component, so this is a page-local re-implementation). It keeps the same
// behavior the operator already relies on — category tabs, a Feed↔Board toggle,
// per-category grouping with "show more", optimistic re-bucketing on status
// change — but renders every insight through <InsightCardKit/> (kit play cards
// with confidence pips, chips, why-rolldowns, quotes) and wraps the kanban /
// empty / still-learning states in Concept A's structure.
//
// The FeedInsight shape + server-action wiring are unchanged from the prior feed.

import { useState, useMemo, useCallback, useEffect, useRef, type CSSProperties } from "react"
import {
  RevealOnView,
  TkSectionHead,
  TkChip,
  TkEmptyState,
  TkStillLearning,
  TkToastProvider,
  type TkFamily,
} from "@/components/ticket"
import {
  getSourceCategory,
  SOURCE_LABELS,
  type SourceCategory,
} from "@/lib/insights/scoring"
import { InsightCardKit } from "./insight-card-kit"
import {
  INSIGHT_RECENT_WINDOW_DAYS,
  defaultRevealCount,
  revealPlan,
  splitByRecency,
  type RevealPlan,
} from "./insights-reveal"

export type FeedInsight = {
  id: string
  title: string
  summary: string
  insightType: string
  competitorId: string | null
  confidence: string
  severity: string
  status: string
  userFeedback: string | null
  relevanceScore: number
  urgencyLevel: "critical" | "warning" | "info"
  suppressed: boolean
  evidence: Record<string, unknown>
  recommendations: Array<Record<string, unknown>>
  subjectLabel: string
  dateKey: string
  /** ALT-230: set on a freshly user-generated insight so the feed pins it to the
   *  top of the pool with a "Just generated" marker (display-only — never affects
   *  the home hero, which excludes user_viz types). */
  justGenerated?: boolean
}

const CATEGORY_ORDER: SourceCategory[] = [
  "competitors", "events", "seo", "social", "content", "photos", "traffic",
]

// The 7 source categories collapse onto 4 chip tints (mirrors insights-map).
const CAT_FAMILY: Record<SourceCategory, TkFamily> = {
  competitors: "reputation",
  events: "competitive",
  seo: "competitive",
  social: "social",
  content: "menu",
  photos: "menu",
  traffic: "competitive",
}

const HIDDEN_STATUSES = new Set(["dismissed", "snoozed", "inaccurate"])
// ALT-184g: "pinned" = kept/saved — the existing positive statuses the Track menu
// already writes (Mark as read / Add to to-do / Mark as done). No new status or
// column: this is the same set <InsightCardKit/> already treats as "kept" for its
// own Track-button fill state.
const PINNED_STATUSES = new Set(["read", "todo", "actioned"])
const CARDS_PER_CATEGORY = 6
const CARDS_PER_COLUMN = 8
const PINNED_PREVIEW_COUNT = 4

const KANBAN_COLUMNS = [
  { key: "inbox", label: "Inbox", statuses: new Set(["new", "read"]) },
  { key: "todo", label: "To-do", statuses: new Set(["todo"]) },
  { key: "done", label: "Done", statuses: new Set(["actioned"]) },
] as const

type Props = {
  insights: FeedInsight[]
  statusFilter: string
  /** N days of fresh coverage so far — drives the still-learning ring */
  learningDays: number
  /** the coverage target (streams checked) */
  learningTarget: number
  /** ALT-230: the raw `?generate=<json viz ctx>` string. When present we POST it to
   *  the generate endpoint, show a spinner at the top of the pool, then pin the
   *  resulting insight there with a "Just generated" marker. */
  generateRequest?: string | null
  /** ALT-292: `YYYY-MM-DD` boundary of the recent window, computed on the server so
   *  SSR and hydration agree. A category defaults to insights on/after this date. */
  recentCutoff: string
}

/** ALT-292: the reveal footer every section shares. One batch per click (never the
 *  whole remainder), an honest count of what is still unloaded, and a way back to the
 *  default view once the operator has expanded past it. */
function RevealFooter({
  plan: { nextCount, remaining, olderNext },
  fullWidth = false,
  onMore,
  onCollapse,
}: {
  plan: RevealPlan
  fullWidth?: boolean
  onMore: () => void
  onCollapse: (() => void) | null
}) {
  if (remaining <= 0 && !onCollapse) return null
  return (
    <div className={`ins-morerow${fullWidth ? " ins-morerow-wide" : ""}`}>
      {remaining > 0 ? (
        <button
          type="button"
          className={`ins-more${fullWidth ? " ins-more-col" : ""}`}
          onClick={onMore}
        >
          {olderNext ? `Show ${nextCount} older` : `Show ${nextCount} more`}
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

export default function InsightsFeedKit({
  insights,
  statusFilter,
  learningDays,
  learningTarget,
  generateRequest,
  recentCutoff,
}: Props) {
  const [activeTab, setActiveTab] = useState("")
  const [viewMode, setViewMode] = useState<"feed" | "board">("feed")
  const [statusOverrides, setStatusOverrides] = useState<Map<string, string>>(new Map())
  // ALT-292: how many cards each section has revealed so far, keyed by section
  // ("cat:social", "col:inbox", "pinned"). An absent key means "still at its default",
  // so a collapse is a delete and a new category needs no seeding. This replaces the
  // old boolean expand flags, which jumped straight from 6 to the whole remainder.
  const [revealCounts, setRevealCounts] = useState<Map<string, number>>(new Map())

  // ── ALT-230: live "Generate insight" from a viz card. We POST the carried-in viz
  //    context once, show a placeholder at the top of the pool, then pin the result. ──
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
    // would render the new row twice (pinned + in its category) and yank the pin away.
    // The pin persists for THIS session; the row settles into its honest rank on the
    // user's next deliberate refresh.
    if (typeof window !== "undefined") window.history.replaceState(null, "", "/insights")
  }, [generateRequest, runFetch])

  const handleStatusChange = useCallback((insightId: string, newStatus: string) => {
    setStatusOverrides((prev) => new Map(prev).set(insightId, newStatus))
  }, [])

  const mergedInsights = useMemo(
    () =>
      insights.map((i) => {
        const override = statusOverrides.get(i.id)
        return override ? { ...i, status: override } : i
      }),
    [insights, statusOverrides],
  )

  const filteredInsights = useMemo(() => {
    let list = mergedInsights
    // Default + "new" views hide cleared items; an explicit cleared-status filter
    // (dismissed/snoozed/inaccurate) keeps them so the operator can review/undo.
    if (!statusFilter || statusFilter === "new" || statusFilter === "") {
      list = list.filter((i) => !HIDDEN_STATUSES.has(i.status))
    }
    if (activeTab) {
      list = list.filter((i) => getSourceCategory(i.insightType, i.competitorId) === activeTab)
    }
    return list
  }, [mergedInsights, activeTab, statusFilter])

  // ── ALT-184g: the Pinned section — kept/saved insights, most-recent first.
  // Reads from `mergedInsights` (not `filteredInsights`) so it's independent of the
  // category tab / status filter: a kept insight stays visible at the top regardless
  // of what the operator is currently filtering the rest of the pool by. ──
  const pinnedInsights = useMemo(
    () =>
      mergedInsights
        .filter((i) => PINNED_STATUSES.has(i.status))
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
    [mergedInsights],
  )

  const tabCounts = useMemo(() => {
    const base = mergedInsights.filter((i) => !HIDDEN_STATUSES.has(i.status))
    const counts: Record<string, number> = { "": base.length }
    for (const ins of base) {
      const cat = getSourceCategory(ins.insightType, ins.competitorId)
      counts[cat] = (counts[cat] ?? 0) + 1
    }
    return counts
  }, [mergedInsights])

  const presentTabs = useMemo(
    () => [{ value: "", label: "All" }].concat(
      CATEGORY_ORDER.filter((c) => (tabCounts[c] ?? 0) > 0).map((c) => ({
        value: c,
        label: SOURCE_LABELS[c],
      })),
    ),
    [tabCounts],
  )

  // ── Feed view: group by source category ──
  const insightsByCategory = useMemo(() => {
    const map = new Map<SourceCategory, FeedInsight[]>()
    for (const ins of filteredInsights) {
      const cat = getSourceCategory(ins.insightType, ins.competitorId)
      const arr = map.get(cat) ?? []
      arr.push(ins)
      map.set(cat, arr)
    }
    return map
  }, [filteredInsights])

  const orderedCategories = useMemo(
    () => CATEGORY_ORDER.filter((cat) => (insightsByCategory.get(cat)?.length ?? 0) > 0),
    [insightsByCategory],
  )

  // ── ALT-292: incremental reveal. `revealMore` adds ONE batch (never the remainder);
  //    `collapse` drops the key so the section falls back to its default count. ──
  const revealMore = useCallback(
    (key: string, from: number, batch: number, max: number) => {
      setRevealCounts((prev) =>
        new Map(prev).set(key, Math.min((prev.get(key) ?? from) + batch, max)),
      )
    },
    [],
  )

  const collapse = useCallback((key: string) => {
    setRevealCounts((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }, [])

  // Per category: recent-window items first, then older ones, each keeping the
  // relevance order the server sent. `recentCount` is where the older run starts.
  const categoryBuckets = useMemo(() => {
    const map = new Map<SourceCategory, { ordered: FeedInsight[]; recentCount: number }>()
    for (const [cat, list] of insightsByCategory) {
      map.set(cat, splitByRecency(list, recentCutoff))
    }
    return map
  }, [insightsByCategory, recentCutoff])

  // ── Board view: group by status column ──
  const columnInsights = useMemo(() => {
    const map = new Map<string, FeedInsight[]>()
    for (const col of KANBAN_COLUMNS) map.set(col.key, [])
    for (const ins of filteredInsights) {
      for (const col of KANBAN_COLUMNS) {
        if (col.statuses.has(ins.status)) {
          map.get(col.key)!.push(ins)
          break
        }
      }
    }
    return map
  }, [filteredInsights])

  const hasAnyInsights = filteredInsights.length > 0

  // Pinned and the board columns have no recency notion (a kept insight or an open
  // to-do doesn't stop mattering after a week), so they pass `recentCount: 0` and get
  // plain batch reveal off the same planner the categories use.
  const pinnedShown = Math.min(
    revealCounts.get("pinned") ?? PINNED_PREVIEW_COUNT,
    pinnedInsights.length,
  )
  const pinnedPlan = revealPlan({
    shown: pinnedShown,
    recentCount: 0,
    total: pinnedInsights.length,
    batch: PINNED_PREVIEW_COUNT,
  })

  // Only pin the generated card while it isn't yet in the server feed. Once a refresh
  // (e.g. a status action's router.refresh, or a later navigation) pulls it in, it shows
  // in its category at its honest rank instead — never both at once (ALT-230).
  const pinnedGenerated = useMemo(
    () => (generated && !insights.some((i) => i.id === generated.id) ? generated : null),
    [generated, insights],
  )

  return (
    <TkToastProvider>
      <div className="ins-feed">
        {/* Tabs + view toggle */}
        <div className="ins-controls">
          <div className="ins-tabs" role="tablist" aria-label="Filter by source">
            {presentTabs.map((tab) => {
              const count = tabCounts[tab.value] ?? 0
              const isActive = activeTab === tab.value
              return (
                <button
                  key={tab.value || "all"}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.value)}
                  className={`ins-tab${isActive ? " ins-tab-on" : ""}`}
                >
                  {tab.label}
                  {count > 0 ? <span className="ins-tab-n">{count}</span> : null}
                </button>
              )
            })}
          </div>

          <div className="ins-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => setViewMode("feed")}
              aria-pressed={viewMode === "feed"}
              className={`ins-vt${viewMode === "feed" ? " ins-vt-on" : ""}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
              <span>Feed</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              aria-pressed={viewMode === "board"}
              className={`ins-vt${viewMode === "board" ? " ins-vt-on" : ""}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 4.5v15m6-15v15M4.5 4.5h15a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6a1.5 1.5 0 0 1 1.5-1.5z" />
              </svg>
              <span>Board</span>
            </button>
          </div>
        </div>

        {/* ── ALT-230: a live-generated insight, pinned to the very top of the pool.
            Shows a shimmer placeholder while generating, then the card with a "Just
            generated" marker. It is display-only here — on a later refresh it settles
            into its honest, low-scored rank within the feed below. ── */}
        {generating && !generated ? (
          <div className="ins-gen-pending" aria-live="polite">
            <div className="ins-gen-skel tk-sweep" aria-hidden="true" />
            <span className="ins-gen-note">Generating your insight…</span>
          </div>
        ) : null}
        {pinnedGenerated ? (
          <div className="ins-gen-landed">
            <InsightCardKit insight={pinnedGenerated} onStatusChange={handleStatusChange} />
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

        {/* ── ALT-184g: Pinned — kept/saved insights, pinned to the TOP of the pool,
            most-recent first. A pinned insight also still appears in its normal
            category/board slot below (same "flagged, not hidden" pattern as the
            brief-linked pool's "Top this week" chip) — this section is a fast, honest
            shortcut to what the operator has already acted on, not a second inbox. ── */}
        {pinnedInsights.length ? (
          <section className="ins-pinned">
            <TkSectionHead
              title="Pinned"
              sub={`${pinnedInsights.length} kept insight${pinnedInsights.length === 1 ? "" : "s"}`}
            />
            <RevealOnView className="tk-grid ins-grid" stagger>
              {pinnedInsights.slice(0, pinnedShown).map((insight, i) => (
                <div key={insight.id} style={{ "--tk-i": i } as CSSProperties}>
                  <InsightCardKit insight={insight} onStatusChange={handleStatusChange} />
                </div>
              ))}
            </RevealOnView>
            <RevealFooter
              plan={pinnedPlan}
              onMore={() =>
                revealMore("pinned", PINNED_PREVIEW_COUNT, PINNED_PREVIEW_COUNT, pinnedInsights.length)
              }
              onCollapse={pinnedShown > PINNED_PREVIEW_COUNT ? () => collapse("pinned") : null}
            />
          </section>
        ) : null}

        {/* ── Feed view (a secondary view relative to Pinned above — ALT-184e gives it
            the same top breathing room the page already uses between major sections). ── */}
        {viewMode === "feed" && hasAnyInsights ? (
          <div className="ins-cats">
            {orderedCategories.map((cat) => {
              // ALT-292: `ordered` is the recent window followed by everything older.
              // The default view stops at the end of the recent window (capped at one
              // batch); a category with nothing recent still opens with a batch of its
              // older items rather than rendering as an empty section.
              const { ordered, recentCount } = categoryBuckets.get(cat) ?? {
                ordered: [],
                recentCount: 0,
              }
              const olderCount = ordered.length - recentCount
              const key = `cat:${cat}`
              const initial = defaultRevealCount(recentCount, ordered.length, CARDS_PER_CATEGORY)
              const shown = Math.min(revealCounts.get(key) ?? initial, ordered.length)
              const visibleRecent = ordered.slice(0, Math.min(shown, recentCount))
              const visibleOlder = ordered.slice(recentCount, shown)
              const plan = revealPlan({
                shown,
                recentCount,
                total: ordered.length,
                batch: CARDS_PER_CATEGORY,
              })

              return (
                <section key={cat} className="ins-cat">
                  <TkSectionHead
                    title={
                      <span className="ins-cat-head">
                        <TkChip family={CAT_FAMILY[cat]}>{SOURCE_LABELS[cat]}</TkChip>
                      </span>
                    }
                    sub={
                      olderCount === 0
                        ? `${recentCount} insight${recentCount === 1 ? "" : "s"} in the last ${INSIGHT_RECENT_WINDOW_DAYS} days`
                        : recentCount === 0
                          ? `Nothing in the last ${INSIGHT_RECENT_WINDOW_DAYS} days, ${olderCount} older`
                          : `${recentCount} in the last ${INSIGHT_RECENT_WINDOW_DAYS} days, ${olderCount} older`
                    }
                  />
                  {visibleRecent.length ? (
                    <RevealOnView className="tk-grid ins-grid" stagger>
                      {visibleRecent.map((insight, i) => (
                        <div key={insight.id} style={{ "--tk-i": i } as CSSProperties}>
                          <InsightCardKit insight={insight} onStatusChange={handleStatusChange} />
                        </div>
                      ))}
                    </RevealOnView>
                  ) : null}
                  {/* The older run gets its own labelled band so revealing it never
                      quietly mixes month-old signal into this week's read. Skipped when
                      the category has no recent items at all: the section sub already
                      says so, and a lone divider over the whole list would just be noise. */}
                  {visibleOlder.length && recentCount > 0 ? (
                    <div className="ins-olderrule">
                      <span>Older than {INSIGHT_RECENT_WINDOW_DAYS} days</span>
                    </div>
                  ) : null}
                  {visibleOlder.length ? (
                    <RevealOnView className="tk-grid ins-grid" stagger>
                      {visibleOlder.map((insight, i) => (
                        <div key={insight.id} style={{ "--tk-i": i } as CSSProperties}>
                          <InsightCardKit insight={insight} onStatusChange={handleStatusChange} />
                        </div>
                      ))}
                    </RevealOnView>
                  ) : null}
                  <RevealFooter
                    plan={plan}
                    onMore={() => revealMore(key, initial, plan.nextCount, ordered.length)}
                    onCollapse={shown > initial ? () => collapse(key) : null}
                  />
                </section>
              )
            })}
          </div>
        ) : null}

        {/* ── Board view ── */}
        {viewMode === "board" && hasAnyInsights ? (
          <div className="ins-board">
            {KANBAN_COLUMNS.map((col) => {
              const colInsights = columnInsights.get(col.key) ?? []
              // ALT-292: same incremental reveal as the feed. No recent window here:
              // a board column is a workflow queue, so hiding older to-dos by date
              // would hide work the operator still owes themselves.
              const key = `col:${col.key}`
              const shown = Math.min(revealCounts.get(key) ?? CARDS_PER_COLUMN, colInsights.length)
              const visible = colInsights.slice(0, shown)
              const plan = revealPlan({
                shown,
                recentCount: 0,
                total: colInsights.length,
                batch: CARDS_PER_COLUMN,
              })
              return (
                <div key={col.key} className={`ins-col ins-col-${col.key}`}>
                  <div className="ins-col-head">
                    <span className="ins-col-dot" aria-hidden="true" />
                    <h3>{col.label}</h3>
                    <span className="ins-col-n">{colInsights.length}</span>
                  </div>
                  <div className="ins-col-body">
                    {visible.length ? (
                      visible.map((insight) => (
                        <InsightCardKit
                          key={insight.id}
                          insight={insight}
                          onStatusChange={handleStatusChange}
                        />
                      ))
                    ) : (
                      <TkEmptyState
                        title={
                          col.key === "inbox"
                            ? "No new insights"
                            : col.key === "todo"
                              ? "Nothing planned yet"
                              : "No completed actions"
                        }
                        description={
                          col.key === "inbox"
                            ? "New signals land here as your sweeps run."
                            : col.key === "todo"
                              ? "Add an insight to your to-do to plan it."
                              : "Mark an insight done when you’ve acted on it."
                        }
                      />
                    )}
                    <RevealFooter
                      plan={plan}
                      fullWidth
                      onMore={() => revealMore(key, CARDS_PER_COLUMN, CARDS_PER_COLUMN, colInsights.length)}
                      onCollapse={shown > CARDS_PER_COLUMN ? () => collapse(key) : null}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {/* ── Empty / still-learning (suppressed while a generation is in flight or
            has just landed, so the pinned card/placeholder owns the top instead) ── */}
        {!hasAnyInsights && !generating && !pinnedGenerated ? (
          activeTab || statusFilter ? (
            <TkEmptyState
              title={
                activeTab
                  ? `No ${SOURCE_LABELS[activeTab as SourceCategory]?.toLowerCase() ?? ""} insights`
                  : statusFilter === "dismissed"
                    ? "No dismissed insights"
                    : statusFilter === "todo"
                      ? "Nothing on your to-do"
                      : statusFilter === "actioned"
                        ? "Nothing marked done"
                        : "No insights match this filter"
              }
              description={
                activeTab
                  ? "Try another source, or generate a fresh sweep."
                  : "Switch the filter, or generate a fresh sweep to see new items."
              }
            />
          ) : (
            <TkStillLearning
              days={Math.max(1, learningDays)}
              target={Math.max(learningTarget, 6)}
              title="Still reading your market"
              description="We’re gathering enough signal to be honest about what matters. Your first insights surface here as the picture fills in — usually within a day or two of your first sweep."
            />
          )
        ) : null}
      </div>
    </TkToastProvider>
  )
}
