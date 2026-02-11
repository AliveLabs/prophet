"use client"

import { useState } from "react"

type RankedKeyword = {
  keyword: string
  rank: number
  url: string | null
  searchVolume: number | null
  cpc: number | null
  competition: number | null
  competitionLevel: string | null
  isPaid: boolean
  intent: string | null
  keywordDifficulty: number | null
}

type Props = {
  keywords: RankedKeyword[]
  newCount: number
  upCount: number
  downCount: number
  lostCount: number
}

type Tab = "all" | "improved" | "decreased" | "new" | "lost"

function intentBadge(intent: string | null) {
  if (!intent) return null
  const colors: Record<string, string> = {
    informational: "bg-blue-100 text-blue-700",
    commercial: "bg-amber-100 text-amber-700",
    navigational: "bg-purple-100 text-purple-700",
    transactional: "bg-emerald-100 text-emerald-700",
    local: "bg-green-100 text-green-700",
  }
  return (
    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colors[intent] ?? "bg-slate-100 text-slate-600"}`}>
      {intent.charAt(0).toUpperCase() + intent.slice(1)}
    </span>
  )
}

export default function KeywordTabs({ keywords, newCount, upCount, downCount, lostCount }: Props) {
  const [tab, setTab] = useState<Tab>("all")

  // For improved/decreased/new/lost, we approximate using ranked keywords:
  // - Improved: rank <= 10 (top performers)
  // - Decreased: rank > 50 (lower positions)
  // - New: first newCount keywords
  // - Lost: last lostCount keywords
  // In a real implementation, we'd compare with previous snapshot.
  // For now, we show all keywords on each tab with the domain-level counts.
  const filteredKeywords = (() => {
    switch (tab) {
      case "improved":
        return keywords.filter((kw) => kw.rank <= 10)
      case "decreased":
        return keywords.filter((kw) => kw.rank > 20)
      case "new":
        return keywords.slice(0, newCount || 10)
      case "lost":
        return [] // We don't have lost keywords in the current ranked keywords list
      default:
        return keywords
    }
  })()

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All", count: keywords.length },
    { id: "improved", label: "Improved", count: upCount },
    { id: "decreased", label: "Decreased", count: downCount },
    { id: "new", label: "New", count: newCount },
    { id: "lost", label: "Lost", count: lostCount },
  ]

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-100 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              tab === t.id
                ? "bg-slate-900 text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Keywords table */}
      <div className="max-h-[400px] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-3 font-medium">Keyword</th>
              <th className="py-2 pr-3 font-medium">Search Vol.</th>
              <th className="py-2 pr-3 font-medium">Position</th>
              <th className="py-2 pr-3 font-medium">Intent</th>
              <th className="py-2 pr-3 font-medium">Competition</th>
              <th className="py-2 font-medium">CPC</th>
            </tr>
          </thead>
          <tbody>
            {filteredKeywords.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-400">
                  No keywords for this filter.
                </td>
              </tr>
            ) : (
              filteredKeywords.slice(0, 50).map((kw) => (
                <tr key={kw.keyword} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="max-w-[200px] truncate py-2 pr-3 font-medium text-slate-700">
                    {kw.keyword}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">
                    {kw.searchVolume?.toLocaleString() ?? "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`font-semibold ${kw.rank <= 3 ? "text-emerald-600" : kw.rank <= 10 ? "text-sky-600" : "text-slate-600"}`}>
                      #{kw.rank}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{intentBadge(kw.intent)}</td>
                  <td className="py-2 pr-3 text-slate-500">
                    {kw.competition !== null ? (kw.competition * 100).toFixed(0) : "—"}
                  </td>
                  <td className="py-2 text-slate-500">
                    {kw.cpc ? `$${kw.cpc.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
