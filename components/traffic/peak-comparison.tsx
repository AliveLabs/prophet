"use client"

import type { CompetitorPeak } from "@/lib/traffic/peak-data"

type Props = {
  competitors: CompetitorPeak[]
}

export default function PeakComparison({ competitors }: Props) {
  if (competitors.length === 0) return null

  const maxScore = Math.max(...competitors.map((c) => c.peak_score), 1)

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-slate-900">Peak Traffic Comparison</h3>
      <div className="space-y-2">
        {competitors.map((comp) => (
          <div key={comp.competitor_name} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{comp.competitor_name}</p>
                <p className="text-[11px] text-slate-500">
                  Busiest: {comp.busiest_day} at {comp.peak_hour}
                  {comp.typical_time_spent && ` · Avg visit: ${comp.typical_time_spent}`}
                </p>
              </div>
              <div className="ml-4 flex items-center gap-3">
                {comp.current_popularity != null && (
                  <div className="text-right">
                    <p className="text-[10px] text-slate-400">Now</p>
                    <p className={`text-sm font-bold ${comp.current_popularity >= 70 ? "text-orange-600" : comp.current_popularity >= 40 ? "text-amber-600" : "text-slate-600"}`}>
                      {comp.current_popularity}%
                    </p>
                  </div>
                )}
                <div className="text-right">
                  <p className="text-[10px] text-slate-400">Peak</p>
                  <p className="text-lg font-bold text-orange-600">{comp.peak_score}%</p>
                </div>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all"
                style={{ width: `${(comp.peak_score / maxScore) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
