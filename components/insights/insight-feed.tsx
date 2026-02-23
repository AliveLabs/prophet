"use client"

import { useState, useMemo } from "react"
import InsightCard from "@/components/insight-card"
import { getSourceCategory, SOURCE_COLORS } from "@/lib/insights/scoring"
import { saveInsightAction, dismissInsightAction } from "@/app/(dashboard)/insights/actions"

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
  { value: "content", label: "Content", color: "text-teal-700", activeColor: "bg-teal-600 text-white", dot: SOURCE_COLORS.content.dot },
]

type Props = {
  insights: FeedInsight[]
  baseParams: Record<string, string>
  statusFilter: string
  preferencesCount: number
}

export default function InsightFeed({ insights, baseParams, statusFilter, preferencesCount }: Props) {
  const [activeTab, setActiveTab] = useState("")

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { "": insights.length, competitors: 0, events: 0, seo: 0, content: 0 }
    for (const ins of insights) {
      const cat = getSourceCategory(ins.insightType, ins.competitorId)
      counts[cat] = (counts[cat] ?? 0) + 1
    }
    return counts
  }, [insights])

  const filtered = useMemo(() => {
    if (!activeTab) return insights
    return insights.filter((i) => getSourceCategory(i.insightType, i.competitorId) === activeTab)
  }, [insights, activeTab])

  const insightsByDate = useMemo(() => {
    const map = new Map<string, FeedInsight[]>()
    for (const ins of filtered) {
      const arr = map.get(ins.dateKey) ?? []
      arr.push(ins)
      map.set(ins.dateKey, arr)
    }
    return map
  }, [filtered])

  const sortedDates = useMemo(
    () => Array.from(insightsByDate.keys()).sort((a, b) => (a > b ? -1 : 1)),
    [insightsByDate]
  )

  const currentParams = { ...baseParams }
  if (activeTab) currentParams.source = activeTab

  return (
    <div className="space-y-6">
      {/* Tabs */}
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

      {/* Feed */}
      {sortedDates.length > 0 ? (
        sortedDates.map((dateKey) => {
          const dayInsights = insightsByDate.get(dateKey) ?? []
          const dateLabel = (() => {
            try {
              return new Date(dateKey + "T12:00:00Z").toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })
            } catch {
              return dateKey
            }
          })()

          return (
            <div key={dateKey}>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-500">{dateLabel}</span>
                <div className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
                <span className="text-[11px] font-medium text-slate-400">
                  {dayInsights.length} insight{dayInsights.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {dayInsights.map((insight) => (
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
                    searchParams={currentParams}
                    actions={
                      <>
                        <form action={saveInsightAction}>
                          <input type="hidden" name="insight_id" value={insight.id} />
                          {Object.entries(currentParams).map(([k, v]) => (
                            <input key={k} type="hidden" name={`_param_${k}`} value={v} />
                          ))}
                          <button
                            type="submit"
                            className={`rounded-lg border p-1.5 transition ${
                              insight.status === "read" || insight.userFeedback === "useful"
                                ? "border-emerald-300 bg-emerald-50 text-emerald-600"
                                : "border-slate-200 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                            }`}
                            title="Save as useful — Prophet learns from your feedback"
                          >
                            <svg className="h-3.5 w-3.5" fill={insight.userFeedback === "useful" ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
                            </svg>
                          </button>
                        </form>
                        <form action={dismissInsightAction}>
                          <input type="hidden" name="insight_id" value={insight.id} />
                          {Object.entries(currentParams).map(([k, v]) => (
                            <input key={k} type="hidden" name={`_param_${k}`} value={v} />
                          ))}
                          <button
                            type="submit"
                            className={`rounded-lg border p-1.5 transition ${
                              insight.status === "dismissed"
                                ? "border-rose-300 bg-rose-50 text-rose-500"
                                : "border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                            }`}
                            title="Dismiss — Prophet learns from your feedback"
                          >
                            <svg className="h-3.5 w-3.5" fill={insight.userFeedback === "not_useful" ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 15h2.25m8.024-9.75c.011.05.028.1.052.148.591 1.2.924 2.55.924 3.977a8.96 8.96 0 01-1.302 4.665c-.245.404.028.96.5.96h1.053c.832 0 1.612-.453 1.918-1.227.306-.774.468-1.614.468-2.523 0-1.553-.295-3.036-.831-4.398C20.613 5.203 19.833 4.75 19 4.75h-1.053c-.472 0-.745.556-.5.96.245.404.028.96-.5.96H14.25M7.5 15v3.375c0 .621-.504 1.125-1.125 1.125h-.375a1.125 1.125 0 01-1.125-1.125V15m3.75 0V9.75A2.25 2.25 0 005.25 7.5h-.375A1.125 1.125 0 003.75 8.625v7.875c0 .621.504 1.125 1.125 1.125h.375c.621 0 1.125-.504 1.125-1.125V15z" />
                            </svg>
                          </button>
                        </form>
                      </>
                    }
                  />
                ))}
              </div>
            </div>
          )
        })
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50">
            <svg className="h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-900">
            {activeTab
              ? `No ${TABS.find((t) => t.value === activeTab)?.label.toLowerCase() ?? ""} insights`
              : statusFilter === "saved"
                ? "No saved insights"
                : statusFilter === "dismissed"
                  ? "No dismissed insights"
                  : "No insights yet"}
          </h3>
          <p className="mx-auto mt-1 max-w-xs text-sm text-slate-500">
            {activeTab
              ? "Try switching to a different category or generate new insights."
              : statusFilter === "saved"
                ? "Save insights you find useful by clicking the thumbs-up button."
                : statusFilter === "dismissed"
                  ? "Dismissed insights will appear here."
                  : "Generate insights or fetch events to see changes and opportunities."}
          </p>
        </div>
      )}

      {/* Learning indicator */}
      {preferencesCount > 0 && (
        <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-slate-400">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          Prophet is learning from your feedback across {preferencesCount} insight type{preferencesCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  )
}
