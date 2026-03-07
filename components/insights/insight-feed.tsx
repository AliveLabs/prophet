"use client"

import { useState, useMemo, useCallback } from "react"
import InsightCard from "@/components/insight-card"
import {
  getSourceCategory,
  SOURCE_COLORS,
  SOURCE_LABELS,
  type SourceCategory,
} from "@/lib/insights/scoring"

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
}

type TabConfig = {
  value: string
  label: string
  color: string
  activeColor: string
  dot: string
}

const TABS: TabConfig[] = [
  { value: "", label: "All", color: "text-slate-600", activeColor: "bg-slate-900 text-white", dot: "bg-slate-400" },
  { value: "competitors", label: "Competitors", color: "text-emerald-700", activeColor: "bg-emerald-600 text-white", dot: SOURCE_COLORS.competitors.dot },
  { value: "events", label: "Events", color: "text-violet-700", activeColor: "bg-violet-600 text-white", dot: SOURCE_COLORS.events.dot },
  { value: "seo", label: "SEO", color: "text-sky-700", activeColor: "bg-sky-600 text-white", dot: SOURCE_COLORS.seo.dot },
  { value: "social", label: "Social", color: "text-indigo-700", activeColor: "bg-indigo-600 text-white", dot: SOURCE_COLORS.social.dot },
  { value: "content", label: "Content", color: "text-teal-700", activeColor: "bg-teal-600 text-white", dot: SOURCE_COLORS.content.dot },
  { value: "photos", label: "Photos", color: "text-pink-700", activeColor: "bg-pink-600 text-white", dot: SOURCE_COLORS.photos.dot },
  { value: "traffic", label: "Traffic", color: "text-orange-700", activeColor: "bg-orange-600 text-white", dot: SOURCE_COLORS.traffic.dot },
]

const CATEGORY_ORDER: SourceCategory[] = [
  "competitors", "events", "seo", "social", "content", "photos", "traffic",
]

const HIDDEN_STATUSES = new Set(["dismissed", "snoozed"])
const CARDS_PER_CATEGORY = 6
const CARDS_PER_COLUMN = 8

const KANBAN_COLUMNS = [
  { key: "inbox", label: "Inbox", statuses: new Set(["new", "read"]), accent: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  { key: "todo", label: "To-Do", statuses: new Set(["todo"]), accent: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  { key: "done", label: "Done", statuses: new Set(["actioned"]), accent: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
] as const

type Props = {
  insights: FeedInsight[]
  baseParams: Record<string, string>
  statusFilter: string
}

export default function InsightFeed({ insights, baseParams, statusFilter }: Props) {
  const [activeTab, setActiveTab] = useState("")
  const [viewMode, setViewMode] = useState<"feed" | "board">("feed")
  const [statusOverrides, setStatusOverrides] = useState<Map<string, string>>(new Map())
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set())

  const handleStatusChange = useCallback((insightId: string, newStatus: string) => {
    setStatusOverrides((prev) => new Map(prev).set(insightId, newStatus))
  }, [])

  const mergedInsights = useMemo(() =>
    insights.map((i) => {
      const override = statusOverrides.get(i.id)
      return override ? { ...i, status: override } : i
    }),
    [insights, statusOverrides]
  )

  const filteredInsights = useMemo(() => {
    let list = mergedInsights

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
    const counts: Record<string, number> = { "": base.length, competitors: 0, events: 0, seo: 0, social: 0, content: 0, photos: 0, traffic: 0 }
    for (const ins of base) {
      const cat = getSourceCategory(ins.insightType, ins.competitorId)
      counts[cat] = (counts[cat] ?? 0) + 1
    }
    return counts
  }, [mergedInsights])

  // ── Feed view: group by category ──────────────────────────────────────

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

  const orderedCategories = useMemo(() =>
    CATEGORY_ORDER.filter((cat) => (insightsByCategory.get(cat)?.length ?? 0) > 0),
    [insightsByCategory]
  )

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }, [])

  // ── Board view: group by status column ────────────────────────────────

  const columnInsights = useMemo(() => {
    const map = new Map<string, FeedInsight[]>()
    for (const col of KANBAN_COLUMNS) {
      map.set(col.key, [])
    }
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
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  // ── Shared empty state ────────────────────────────────────────────────

  const hasAnyInsights = filteredInsights.length > 0

  return (
    <div className="space-y-6">
      {/* Header: Tabs + View Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((tab) => {
            const count = tabCounts[tab.value] ?? 0
            const isActive = activeTab === tab.value
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  isActive
                    ? tab.activeColor + " shadow-sm"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {tab.value && (
                  <span className={`h-2 w-2 rounded-full ${isActive ? "bg-white/40" : tab.dot}`} />
                )}
                {tab.label}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("feed")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              viewMode === "feed"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            title="Category feed"
          >
            <ListIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Feed</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("board")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              viewMode === "board"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            title="Kanban board"
          >
            <BoardIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Board</span>
          </button>
        </div>
      </div>

      {/* ── Feed View ────────────────────────────────────────────────── */}
      {viewMode === "feed" && hasAnyInsights && (
        <div className="space-y-8">
          {orderedCategories.map((cat) => {
            const catInsights = insightsByCategory.get(cat) ?? []
            const isExpanded = expandedCategories.has(cat)
            const displayLimit = isExpanded ? catInsights.length : CARDS_PER_CATEGORY
            const visible = catInsights.slice(0, displayLimit)
            const remaining = catInsights.length - displayLimit
            const colors = SOURCE_COLORS[cat]

            return (
              <section key={cat}>
                <div className="mb-3 flex items-center gap-3">
                  <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1 ${colors.bg}`}>
                    <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
                    <span className={`text-xs font-bold ${colors.text}`}>
                      {SOURCE_LABELS[cat]}
                    </span>
                  </div>
                  <div className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
                  <span className="text-[11px] font-medium text-slate-400">
                    {catInsights.length} insight{catInsights.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visible.map((insight) => (
                    <InsightCard
                      key={insight.id}
                      id={insight.id}
                      title={insight.title}
                      summary={insight.summary}
                      insightType={insight.insightType}
                      competitorId={insight.competitorId}
                      confidence={insight.confidence}
                      severity={insight.severity}
                      status={insight.status}
                      userFeedback={insight.userFeedback}
                      relevanceScore={insight.relevanceScore}
                      urgencyLevel={insight.urgencyLevel}
                      suppressed={insight.suppressed}
                      evidence={insight.evidence}
                      recommendations={insight.recommendations}
                      subjectLabel={insight.subjectLabel}
                      searchParams={baseParams}
                      onStatusChange={handleStatusChange}
                    />
                  ))}
                </div>

                {remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                  >
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                    Show {remaining} more
                  </button>
                )}

                {isExpanded && catInsights.length > CARDS_PER_CATEGORY && (
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                  >
                    <ChevronUpIcon className="h-3.5 w-3.5" />
                    Show less
                  </button>
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* ── Board View ───────────────────────────────────────────────── */}
      {viewMode === "board" && hasAnyInsights && (
        <div className="grid gap-4 lg:grid-cols-3">
          {KANBAN_COLUMNS.map((col) => {
            const colInsights = columnInsights.get(col.key) ?? []
            const isExpanded = expandedColumns.has(col.key)
            const displayLimit = isExpanded ? colInsights.length : CARDS_PER_COLUMN
            const visible = colInsights.slice(0, displayLimit)
            const remaining = colInsights.length - displayLimit

            return (
              <div key={col.key} className="flex flex-col rounded-2xl border border-slate-200 bg-slate-50/50">
                {/* Column header */}
                <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${col.accent}`} />
                  <h3 className="text-sm font-bold text-slate-800">{col.label}</h3>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${col.bg} ${col.text}`}>
                    {colInsights.length}
                  </span>
                </div>

                {/* Column body */}
                <div className="flex-1 space-y-2.5 p-3">
                  {visible.length > 0 ? (
                    visible.map((insight) => (
                      <InsightCard
                        key={insight.id}
                        id={insight.id}
                        title={insight.title}
                        summary={insight.summary}
                        insightType={insight.insightType}
                        competitorId={insight.competitorId}
                        confidence={insight.confidence}
                        severity={insight.severity}
                        status={insight.status}
                        userFeedback={insight.userFeedback}
                        relevanceScore={insight.relevanceScore}
                        urgencyLevel={insight.urgencyLevel}
                        suppressed={insight.suppressed}
                        evidence={insight.evidence}
                        recommendations={insight.recommendations}
                        subjectLabel={insight.subjectLabel}
                        searchParams={baseParams}
                        onStatusChange={handleStatusChange}
                      />
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white py-8 text-center">
                      <p className="text-xs font-medium text-slate-400">
                        {col.key === "inbox" && "No new insights"}
                        {col.key === "todo" && "Nothing planned yet"}
                        {col.key === "done" && "No completed actions"}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-300">
                        {col.key === "inbox" && "Generate insights or fetch data to see new items"}
                        {col.key === "todo" && "Mark insights as \"To-Do\" to plan actions"}
                        {col.key === "done" && "Mark insights as \"Done\" when actioned"}
                      </p>
                    </div>
                  )}

                  {remaining > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleColumn(col.key)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 bg-white py-2 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                    >
                      <ChevronDownIcon className="h-3 w-3" />
                      {remaining} more
                    </button>
                  )}

                  {isExpanded && colInsights.length > CARDS_PER_COLUMN && (
                    <button
                      type="button"
                      onClick={() => toggleColumn(col.key)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 bg-white py-2 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                    >
                      <ChevronUpIcon className="h-3 w-3" />
                      Show less
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {!hasAnyInsights && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50">
            <svg className="h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-900">
            {activeTab
              ? `No ${TABS.find((t) => t.value === activeTab)?.label.toLowerCase() ?? ""} insights`
              : statusFilter === "dismissed"
                ? "No dismissed insights"
                : statusFilter === "todo"
                  ? "No to-do insights"
                  : statusFilter === "actioned"
                    ? "No actioned insights"
                    : "No insights yet"}
          </h3>
          <p className="mx-auto mt-1 max-w-xs text-sm text-slate-500">
            {activeTab
              ? "Try switching to a different category or generate new insights."
              : "Generate insights or fetch data to see changes and opportunities."}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Icons ─────────────────────────────────────────────────────────────

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
    </svg>
  )
}

function BoardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15M4.5 4.5h15a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18V6a1.5 1.5 0 011.5-1.5z" />
    </svg>
  )
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  )
}

function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
    </svg>
  )
}
