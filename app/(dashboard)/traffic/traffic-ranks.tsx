"use client"

// The Pass — average busy-score ranking (client island, page-local).
//
// Re-implements components/traffic/peak-comparison.tsx with the kit's TkRangeBar
// (animated 0→value fill + point marker). Each row is a competitor's average peak
// across the week (% of typical peak), with their busiest slot + a "now" chip when
// live popularity is known. Honest: no $/covers — only Google-Maps busy scores.

import { TkRangeBar } from "@/components/ticket"
import type { CompetitorPeak } from "@/lib/traffic/peak-data"

export default function TrafficRanks({ competitors }: { competitors: CompetitorPeak[] }) {
  if (competitors.length === 0) return null

  const sorted = [...competitors].sort((a, b) => b.avg_peak - a.avg_peak)
  // ALT-722: these averages can rest on different numbers of days, so the set average is a mean of
  // means over unequal denominators. Left as-is because it is a rough reference line, not a claim,
  // but the per-competitor caption below now states its own denominator rather than asserting a
  // full week for everyone.
  const setAvg = Math.round(sorted.reduce((s, c) => s + c.avg_peak, 0) / sorted.length)
  const FULL_WEEK = 7

  return (
    <div className="tk-trf-ranks">
      {sorted.map((comp) => {
        const now = comp.current_popularity
        const liveBusy = now != null && now >= 40
        return (
          <div key={comp.competitor_name} className="tk-trf-rank">
            <div className="tk-trf-rank-head">
              <span className="tk-trf-rank-name">{comp.competitor_name}</span>
              {now != null && (
                <span className={`tk-trf-rank-now${liveBusy ? "" : " tk-quiet"}`}>
                  {liveBusy ? "Busy now" : "Quiet now"} · {now}%
                </span>
              )}
            </div>
            <TkRangeBar
              value={comp.avg_peak}
              scale={["0%", `set avg ${setAvg}%`, "100%"]}
              caption={
                comp.days_observed >= FULL_WEEK
                  ? "Avg busy across the week"
                  : `Avg busy across ${comp.days_observed} day${comp.days_observed === 1 ? "" : "s"}`
              }
              captionRight={`${comp.avg_peak}%`}
              tip={`Busiest ${comp.busiest_day} at ${comp.peak_hour}${comp.typical_time_spent ? ` · avg visit ${comp.typical_time_spent}` : ""}${comp.days_observed < FULL_WEEK ? ` · only ${comp.days_observed} of 7 days measured` : ""}`}
              tipValue={`${comp.avg_peak}% of peak`}
            />
            <span className="tk-trf-rank-meta">
              Busiest {comp.busiest_day} at {comp.peak_hour}
              {comp.typical_time_spent ? ` · typical visit ${comp.typical_time_spent}` : ""}
            </span>
          </div>
        )
      })}
    </div>
  )
}
