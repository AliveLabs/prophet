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
  if (score === 0) return "bg-secondary"
  if (score < 20) return "bg-signal-gold/20"
  if (score < 40) return "bg-signal-gold/40"
  if (score < 60) return "bg-signal-gold/60"
  if (score < 80) return "bg-signal-gold/80"
  return "bg-signal-gold"
}

function getHeatTextColor(score: number): string {
  return score >= 60 ? "text-white" : "text-muted-foreground"
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

  if (!isClient) return <div className="h-80 animate-pulse rounded-2xl bg-secondary" />
  if (data.length === 0) return null

  const competitor = data.find((d) => d.competitor_id === selectedCompetitor) ?? data[0]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-bold text-foreground">Weekly Heatmap</h3>
        <select
          value={selectedCompetitor}
          onChange={(e) => setSelectedCompetitor(e.target.value)}
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
        >
          {data.map((d) => (
            <option key={d.competitor_id} value={d.competitor_id}>
              {d.competitor_name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-center text-[10px]">
          <thead>
            <tr className="bg-secondary">
              <th className="px-2 py-2 text-left text-[10px] font-semibold text-muted-foreground">Day</th>
              {HOURS.map((h) => (
                <th key={h} className="px-1 py-2 font-medium text-muted-foreground">
                  {formatHour(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_LABELS.map((dayLabel, dow) => {
              const dayData = competitor.days.find((d) => d.day_of_week === dow)
              return (
                <tr key={dow} className="border-t border-border">
                  <td className="px-2 py-1.5 text-left text-[11px] font-semibold text-foreground">
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

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>Less busy</span>
        <div className="flex gap-0.5">
          {["bg-secondary", "bg-signal-gold/20", "bg-signal-gold/40", "bg-signal-gold/60", "bg-signal-gold/80", "bg-signal-gold"].map((c) => (
            <div key={c} className={`h-3 w-5 rounded ${c}`} />
          ))}
        </div>
        <span>More busy</span>
      </div>
    </div>
  )
}
