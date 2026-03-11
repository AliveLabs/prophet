"use client"

import type { HeatmapData } from "./traffic-heatmap"

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatHour(h: number): string {
  if (h === 0) return "12am"
  if (h === 12) return "12pm"
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

type TrafficInsight = {
  title: string
  summary: string
  severity: "positive" | "warning" | "info"
  icon: "opportunity" | "overlap" | "dead" | "trend"
}

function generateTrafficInsights(data: HeatmapData[]): TrafficInsight[] {
  if (data.length === 0) return []
  const insights: TrafficInsight[] = []

  // Off-peak opportunities: find hours when ALL competitors are below 30%
  const opportunities: Array<{ day: string; hour: string; avgScore: number }> = []
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 10; h < 21; h++) {
      const scores: number[] = []
      for (const comp of data) {
        const dayData = comp.days.find((d) => d.day_of_week === dow)
        if (dayData?.hourly_scores[h] != null) {
          scores.push(dayData.hourly_scores[h])
        }
      }
      if (scores.length > 0 && scores.every((s) => s < 30) && scores.some((s) => s > 0)) {
        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        opportunities.push({ day: DAY_NAMES[dow], hour: formatHour(h), avgScore: avg })
      }
    }
  }

  if (opportunities.length > 0) {
    const topOpps = opportunities.sort((a, b) => a.avgScore - b.avgScore).slice(0, 3)
    const oppList = topOpps.map((o) => `${o.day} at ${o.hour} (${o.avgScore}%)`).join(", ")
    insights.push({
      title: "Low Competition Windows",
      summary: `These times show all competitors below 30% capacity: ${oppList}. Consider running promotions during these windows to capture unmet demand.`,
      severity: "positive",
      icon: "opportunity",
    })
  }

  // Head-to-head overlap: hours where multiple competitors peak (>80%) simultaneously
  const overlaps: Array<{ day: string; hour: string; competitors: string[] }> = []
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 10; h < 21; h++) {
      const peaking: string[] = []
      for (const comp of data) {
        const dayData = comp.days.find((d) => d.day_of_week === dow)
        if (dayData && dayData.hourly_scores[h] >= 80) {
          peaking.push(comp.competitor_name)
        }
      }
      if (peaking.length >= 2) {
        overlaps.push({ day: DAY_NAMES[dow], hour: formatHour(h), competitors: peaking })
      }
    }
  }

  if (overlaps.length > 0) {
    const topOverlap = overlaps[0]
    insights.push({
      title: "Peak Hour Competition",
      summary: `${topOverlap.competitors.join(" and ")} both hit 80%+ capacity on ${topOverlap.day} at ${topOverlap.hour}. ${overlaps.length > 1 ? `This pattern repeats across ${overlaps.length} time slots.` : ""} Diners may face waits — position yourself as the alternative.`,
      severity: "info",
      icon: "overlap",
    })
  }

  // Slow period detection: consecutive hours with < 20% across business hours
  for (const comp of data) {
    for (const day of comp.days) {
      let slowStart = -1
      let slowLen = 0
      for (let h = 10; h < 21; h++) {
        if (day.hourly_scores[h] < 20) {
          if (slowStart === -1) slowStart = h
          slowLen++
        } else {
          if (slowLen >= 3) {
            insights.push({
              title: `Dead Zone: ${comp.competitor_name}`,
              summary: `${comp.competitor_name} sees very low traffic on ${DAY_NAMES[day.day_of_week]} from ${formatHour(slowStart)} to ${formatHour(slowStart + slowLen)}. This ${slowLen}-hour quiet period suggests an opportunity for happy hour, events, or targeted promotions.`,
              severity: "warning",
              icon: "dead",
            })
          }
          slowStart = -1
          slowLen = 0
        }
      }
      if (slowLen >= 3) {
        insights.push({
          title: `Dead Zone: ${comp.competitor_name}`,
          summary: `${comp.competitor_name} sees very low traffic on ${DAY_NAMES[day.day_of_week]} from ${formatHour(slowStart)} to ${formatHour(slowStart + slowLen)}. This quiet period suggests an opportunity for events or promotions.`,
          severity: "warning",
          icon: "dead",
        })
      }
    }
  }

  // Weekend vs weekday comparison
  const weekdayScores: number[] = []
  const weekendScores: number[] = []
  for (const comp of data) {
    for (const day of comp.days) {
      const avg = day.hourly_scores.slice(10, 21).reduce((a, b) => a + b, 0) / 11
      if (day.day_of_week === 0 || day.day_of_week === 6) {
        weekendScores.push(avg)
      } else {
        weekdayScores.push(avg)
      }
    }
  }

  if (weekdayScores.length > 0 && weekendScores.length > 0) {
    const avgWeekday = Math.round(weekdayScores.reduce((a, b) => a + b, 0) / weekdayScores.length)
    const avgWeekend = Math.round(weekendScores.reduce((a, b) => a + b, 0) / weekendScores.length)
    const diff = avgWeekend - avgWeekday
    const stronger = diff > 5 ? "weekends" : diff < -5 ? "weekdays" : null

    if (stronger) {
      insights.push({
        title: `${stronger === "weekends" ? "Weekend" : "Weekday"} Traffic Dominance`,
        summary: `Competitors average ${stronger === "weekends" ? avgWeekend : avgWeekday}% capacity on ${stronger} vs ${stronger === "weekends" ? avgWeekday : avgWeekend}% on ${stronger === "weekends" ? "weekdays" : "weekends"}. ${stronger === "weekends" ? "Consider stronger weekday promotions to boost mid-week traffic." : "Weekdays see higher traffic — focus weekend efforts on events or specials to draw more diners."}`,
        severity: "info",
        icon: "trend",
      })
    }
  }

  // Deduplicate and limit
  const seen = new Set<string>()
  return insights.filter((ins) => {
    if (seen.has(ins.title)) return false
    seen.add(ins.title)
    return true
  }).slice(0, 6)
}

const SEVERITY_STYLES: Record<string, string> = {
  positive: "border-emerald-200 bg-emerald-50",
  warning: "border-amber-200 bg-amber-50",
  info: "border-blue-200 bg-blue-50",
}

const ICON_COLORS: Record<string, string> = {
  positive: "text-emerald-500",
  warning: "text-amber-500",
  info: "text-blue-500",
}

export default function TrafficInsightsSection({ data }: { data: HeatmapData[] }) {
  const insights = generateTrafficInsights(data)
  if (insights.length === 0) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-900">Traffic Intelligence</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Actionable patterns from competitor busy times data
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {insights.map((ins, idx) => (
          <div
            key={idx}
            className={`rounded-xl border p-4 ${SEVERITY_STYLES[ins.severity]}`}
          >
            <div className="flex items-start gap-2">
              <div className={`mt-0.5 ${ICON_COLORS[ins.severity]}`}>
                <InsightIcon type={ins.icon} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{ins.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{ins.summary}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InsightIcon({ type }: { type: string }) {
  const cls = "h-5 w-5"
  switch (type) {
    case "opportunity":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case "overlap":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      )
    case "dead":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
        </svg>
      )
    default:
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941" />
        </svg>
      )
  }
}
