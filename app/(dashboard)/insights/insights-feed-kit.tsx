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
const CARDS_PER_CATEGORY = 6
const CARDS_PER_COLUMN = 8

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
}

export default function InsightsFeedKit({
  insights,
  statusFilter,
  learningDays,
  learningTarget,
  generateRequest,
}: Props) {
  const [activeTab, setActiveTab] = useState("")
  const [viewMode, setViewMode] = useState<"feed" | "board">("feed")
  const [statusOverrides, setStatusOverrides] = useState<Map<string, string>>(new Map())
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set())

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
      .then((r) => r.json())
      .then((data: { insight: FeedInsight | null }) => {
        if (data?.insight?.id) setGenerated({ ...data.insight, justGenerated: true })
        else setGenError("We couldn’t generate that just now.")
      })
      .catch(() => setGenError("We couldn’t generate that just now."))
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

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

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

  const toggleColumn = useCallback((key: string) => {
    setExpandedColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const hasAnyInsights = filteredInsights.length > 0

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

        {/* ── Feed view ── */}
        {viewMode === "feed" && hasAnyInsights ? (
          <div className="ins-cats">
            {orderedCategories.map((cat) => {
              const catInsights = insightsByCategory.get(cat) ?? []
              const isExpanded = expandedCategories.has(cat)
              const limit = isExpanded ? catInsights.length : CARDS_PER_CATEGORY
              const visible = catInsights.slice(0, limit)
              const remaining = catInsights.length - limit

              return (
                <section key={cat} className="ins-cat">
                  <TkSectionHead
                    title={
                      <span className="ins-cat-head">
                        <TkChip family={CAT_FAMILY[cat]}>{SOURCE_LABELS[cat]}</TkChip>
                      </span>
                    }
                    sub={`${catInsights.length} insight${catInsights.length === 1 ? "" : "s"}`}
                  />
                  <RevealOnView className="tk-grid ins-grid" stagger>
                    {visible.map((insight, i) => (
                      <div key={insight.id} style={{ "--tk-i": i } as CSSProperties}>
                        <InsightCardKit insight={insight} onStatusChange={handleStatusChange} />
                      </div>
                    ))}
                  </RevealOnView>
                  {remaining > 0 ? (
                    <button type="button" className="ins-more" onClick={() => toggleCategory(cat)}>
                      Show {remaining} more
                    </button>
                  ) : isExpanded && catInsights.length > CARDS_PER_CATEGORY ? (
                    <button type="button" className="ins-more" onClick={() => toggleCategory(cat)}>
                      Show less
                    </button>
                  ) : null}
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
              const isExpanded = expandedColumns.has(col.key)
              const limit = isExpanded ? colInsights.length : CARDS_PER_COLUMN
              const visible = colInsights.slice(0, limit)
              const remaining = colInsights.length - limit
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
                    {remaining > 0 ? (
                      <button type="button" className="ins-more ins-more-col" onClick={() => toggleColumn(col.key)}>
                        {remaining} more
                      </button>
                    ) : isExpanded && colInsights.length > CARDS_PER_COLUMN ? (
                      <button type="button" className="ins-more ins-more-col" onClick={() => toggleColumn(col.key)}>
                        Show less
                      </button>
                    ) : null}
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
