"use client"

import { useState, useSyncExternalStore } from "react"

export type HeatmapData = {
  competitor_id: string
  competitor_name: string
  days: Array<{
    day_of_week: number
    hourly_scores: number[]
    peak_hour: number
    peak_score: number
    typical_time_spent: string | null
  }>
}

type Props = {
  data: HeatmapData[]
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)

function formatHour(h: number): string {
  if (h === 0) return "12a"
  if (h === 12) return "12p"
  return h < 12 ? `${h}a` : `${h - 12}p`
}

function getHeatColor(score: number): string {
  if (score === 0) return "bg-slate-50"
  if (score < 20) return "bg-orange-100"
  if (score < 40) return "bg-orange-200"
  if (score < 60) return "bg-orange-300"
  if (score < 80) return "bg-orange-400"
  return "bg-orange-500"
}

function getHeatTextColor(score: number): string {
  return score >= 60 ? "text-white" : "text-slate-600"
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

export default function TrafficHeatmap({ data }: Props) {
  const isClient = useIsClient()
  const [selectedCompetitor, setSelectedCompetitor] = useState(data[0]?.competitor_id ?? "")

  if (!isClient) return <div className="h-80 animate-pulse rounded-2xl bg-slate-100" />
  if (data.length === 0) return null

  const competitor = data.find((d) => d.competitor_id === selectedCompetitor) ?? data[0]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-bold text-slate-900">Weekly Heatmap</h3>
        <select
          value={selectedCompetitor}
          onChange={(e) => setSelectedCompetitor(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
        >
          {data.map((d) => (
            <option key={d.competitor_id} value={d.competitor_id}>
              {d.competitor_name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-center text-[10px]">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-2 py-2 text-left text-[10px] font-semibold text-slate-500">Day</th>
              {HOURS.map((h) => (
                <th key={h} className="px-1 py-2 font-medium text-slate-400">
                  {formatHour(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_LABELS.map((dayLabel, dow) => {
              const dayData = competitor.days.find((d) => d.day_of_week === dow)
              return (
                <tr key={dow} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 text-left text-[11px] font-semibold text-slate-700">
                    {dayLabel}
                  </td>
                  {HOURS.map((h) => {
                    const score = dayData?.hourly_scores[h] ?? 0
                    return (
                      <td key={h} className="px-0.5 py-0.5">
                        <div
                          className={`mx-auto flex h-7 w-7 items-center justify-center rounded-md text-[9px] font-bold transition-all ${getHeatColor(score)} ${getHeatTextColor(score)}`}
                          title={`${dayLabel} ${formatHour(h)}: ${score}%`}
                        >
                          {score > 0 ? score : ""}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-slate-400">
        <span>Less busy</span>
        <div className="flex gap-0.5">
          {["bg-slate-50", "bg-orange-100", "bg-orange-200", "bg-orange-300", "bg-orange-400", "bg-orange-500"].map((c) => (
            <div key={c} className={`h-3 w-5 rounded ${c}`} />
          ))}
        </div>
        <span>More busy</span>
      </div>
    </div>
  )
}
