"use client"

import type { CompetitorPeak } from "@/lib/traffic/peak-data"

type Props = {
  competitors: CompetitorPeak[]
}

export default function PeakComparison({ competitors }: Props) {
  if (competitors.length === 0) return null

  const sorted = [...competitors].sort((a, b) => b.avg_peak - a.avg_peak)
  const maxAvgPeak = Math.max(...sorted.map((c) => c.avg_peak), 1)

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-foreground">Average Busy Score</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Average peak traffic across all 7 days (not just the single busiest hour)
        </p>
      </div>
      <div className="space-y-2">
        {sorted.map((comp) => (
          <div key={comp.competitor_name} className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{comp.competitor_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  Busiest: {comp.busiest_day} at {comp.peak_hour}
                  {comp.typical_time_spent && ` · Avg visit: ${comp.typical_time_spent}`}
                </p>
              </div>
              <div className="ml-4 flex items-center gap-3">
                {comp.current_popularity != null && (
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Now</p>
                    <p className={`text-sm font-bold ${comp.current_popularity >= 70 ? "text-signal-gold" : comp.current_popularity >= 40 ? "text-signal-gold" : "text-muted-foreground"}`}>
                      {comp.current_popularity}%
                    </p>
                  </div>
                )}
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Avg Peak</p>
                  <p className="text-lg font-bold text-signal-gold">{comp.avg_peak}%</p>
                </div>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-gradient-to-r from-signal-gold/70 to-signal-gold transition-all"
                style={{ width: `${(comp.avg_peak / maxAvgPeak) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
