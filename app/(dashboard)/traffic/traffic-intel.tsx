// The Pass — Traffic Intelligence (server-safe, page-local).
//
// Re-implements the presentation of components/traffic/traffic-insights.tsx with
// the kit. The pattern-detection logic is pure/deterministic (no hooks), kept
// HONEST: busy scores are "% of typical peak" from Google Maps — never $/covers.
// Rendered as kit cards inside a TkWidget-flavored grid.

import { TkCard } from "@/components/ticket"
import type { TrafficData } from "./traffic-types"

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatHour(h: number): string {
  if (h === 0) return "12am"
  if (h === 12) return "12pm"
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

type Severity = "positive" | "warning" | "info"
type IconKind = "opportunity" | "overlap" | "dead" | "trend"
type TrafficInsight = { title: string; summary: string; severity: Severity; icon: IconKind }

export function generateTrafficInsights(data: TrafficData[]): TrafficInsight[] {
  if (data.length === 0) return []
  const insights: TrafficInsight[] = []

  // Off-peak opportunities: hours when ALL competitors are below 30%.
  const opportunities: Array<{ day: string; hour: string; avgScore: number }> = []
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 10; h < 21; h++) {
      const scores: number[] = []
      for (const comp of data) {
        const dayData = comp.days.find((d) => d.day_of_week === dow)
        if (dayData?.hourly_scores[h] != null) scores.push(dayData.hourly_scores[h])
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
      title: "Low-competition windows",
      summary: `Every tracked competitor sits below 30% of their peak at: ${oppList}. These are your openings to run a promotion and capture demand that isn't being fought over.`,
      severity: "positive",
      icon: "opportunity",
    })
  }

  // Head-to-head overlap: multiple competitors peaking (>80%) at once.
  const overlaps: Array<{ day: string; hour: string; competitors: string[] }> = []
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 10; h < 21; h++) {
      const peaking: string[] = []
      for (const comp of data) {
        const dayData = comp.days.find((d) => d.day_of_week === dow)
        if (dayData && dayData.hourly_scores[h] >= 80) peaking.push(comp.competitor_name)
      }
      if (peaking.length >= 2) overlaps.push({ day: DAY_NAMES[dow], hour: formatHour(h), competitors: peaking })
    }
  }
  if (overlaps.length > 0) {
    const top = overlaps[0]
    insights.push({
      title: "Peak-hour crunch",
      summary: `${top.competitors.join(" and ")} both hit 80%+ of peak on ${top.day} at ${top.hour}.${overlaps.length > 1 ? ` This repeats across ${overlaps.length} time slots.` : ""} Their diners are likely facing waits — position yourself as the no-wait alternative.`,
      severity: "info",
      icon: "overlap",
    })
  }

  // Slow periods: 3+ consecutive hours under 20% during business hours.
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
              title: `Dead zone · ${comp.competitor_name}`,
              summary: `${comp.competitor_name} runs very quiet on ${DAY_NAMES[day.day_of_week]} from ${formatHour(slowStart)} to ${formatHour(slowStart + slowLen)}. That ${slowLen}-hour lull is room for a happy hour, an event, or a targeted push.`,
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
          title: `Dead zone · ${comp.competitor_name}`,
          summary: `${comp.competitor_name} runs very quiet on ${DAY_NAMES[day.day_of_week]} from ${formatHour(slowStart)} to ${formatHour(slowStart + slowLen)}. That lull is room for an event or a targeted push.`,
          severity: "warning",
          icon: "dead",
        })
      }
    }
  }

  // Weekend vs weekday pattern.
  const weekdayScores: number[] = []
  const weekendScores: number[] = []
  for (const comp of data) {
    for (const day of comp.days) {
      const avg = day.hourly_scores.slice(10, 21).reduce((a, b) => a + b, 0) / 11
      if (day.day_of_week === 0 || day.day_of_week === 6) weekendScores.push(avg)
      else weekdayScores.push(avg)
    }
  }
  if (weekdayScores.length > 0 && weekendScores.length > 0) {
    const avgWeekday = Math.round(weekdayScores.reduce((a, b) => a + b, 0) / weekdayScores.length)
    const avgWeekend = Math.round(weekendScores.reduce((a, b) => a + b, 0) / weekendScores.length)
    const diff = avgWeekend - avgWeekday
    const stronger = diff > 5 ? "weekends" : diff < -5 ? "weekdays" : null
    if (stronger) {
      insights.push({
        title: `${stronger === "weekends" ? "Weekend" : "Weekday"} skew`,
        summary: `Competitors average ${stronger === "weekends" ? avgWeekend : avgWeekday}% of peak on ${stronger} vs ${stronger === "weekends" ? avgWeekday : avgWeekend}% on ${stronger === "weekends" ? "weekdays" : "weekends"}. ${stronger === "weekends" ? "Lean into weekday promotions to lift the slower half of the week." : "Use weekend events or specials to draw the crowd into the quieter half."}`,
        severity: "info",
        icon: "trend",
      })
    }
  }

  const seen = new Set<string>()
  return insights
    .filter((ins) => {
      if (seen.has(ins.title)) return false
      seen.add(ins.title)
      return true
    })
    .slice(0, 6)
}

function InsightIcon({ type }: { type: IconKind }) {
  switch (type) {
    case "opportunity":
      return (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case "overlap":
      return (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.7a3 3 0 10-2-5.2M15 19.1A12.3 12.3 0 018.6 21 12.3 12.3 0 012.3 19.2 6.4 6.4 0 0114.2 16M12 6.4a3.4 3.4 0 11-6.8 0 3.4 3.4 0 016.8 0z" />
        </svg>
      )
    case "dead":
      return (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.1c0-.6.5-1.1 1.1-1.1h2.3c.6 0 1.1.5 1.1 1.1v6.8c0 .6-.5 1.1-1.1 1.1H4.1A1.1 1.1 0 013 19.9v-6.8z" />
        </svg>
      )
    default:
      return (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.3 18L9 11.3l4.3 4.3a12 12 0 015.8-5.5l2.7-1.2m0 0l-5.9-2.3m5.9 2.3l-2.3 5.9" />
        </svg>
      )
  }
}

export default function TrafficIntel({ insights }: { insights: TrafficInsight[] }) {
  if (insights.length === 0) return null

  return (
    <div className="tk-trf-intel">
      {insights.map((ins, i) => (
        <TkCard key={i} className="tk-trf-icard">
          <div className="tk-trf-icard-top">
            <span className={`tk-trf-iico tk-${ins.severity === "positive" ? "pos" : ins.severity === "warning" ? "warn" : "info"}`}>
              <InsightIcon type={ins.icon} />
            </span>
            <span className="tk-trf-ititle">{ins.title}</span>
          </div>
          <p className="tk-trf-isum">{ins.summary}</p>
        </TkCard>
      ))}
    </div>
  )
}
