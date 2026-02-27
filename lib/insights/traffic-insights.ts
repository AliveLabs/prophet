import type { GeneratedInsight } from "./types"

export type BusyTimesSnapshot = {
  day_of_week: number
  hourly_scores: number[]
  peak_hour: number
  peak_score: number
  slow_hours: number[]
  typical_time_spent: string | null
}

export type TrafficInsightInput = {
  competitorName: string
  competitorId: string
  current: BusyTimesSnapshot[]
  previous: BusyTimesSnapshot[] | null
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatHour(h: number): string {
  if (h === 0) return "12am"
  if (h === 12) return "12pm"
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export function generateTrafficInsights(input: TrafficInsightInput): GeneratedInsight[] {
  const { competitorName, current, previous } = input
  const insights: GeneratedInsight[] = []

  if (!previous || previous.length === 0) {
    const peaks = current
      .filter(d => d.peak_score > 0)
      .sort((a, b) => b.peak_score - a.peak_score)
      .slice(0, 3)

    if (peaks.length > 0) {
      insights.push({
        insight_type: "traffic.baseline",
        title: `${competitorName} traffic patterns captured`,
        summary: `Peak times: ${peaks.map(p => `${DAY_NAMES[p.day_of_week]} at ${formatHour(p.peak_hour)} (${p.peak_score}%)`).join(", ")}. Future updates will detect changes.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          competitor_name: competitorName,
          competitor_id: input.competitorId,
          peaks: peaks.map(p => ({
            day: DAY_NAMES[p.day_of_week],
            hour: p.peak_hour,
            score: p.peak_score,
          })),
          typical_time_spent: current[0]?.typical_time_spent ?? null,
        },
        recommendations: [],
      })
    }
    return insights
  }

  const prevByDay = new Map(previous.map(d => [d.day_of_week, d]))

  for (const cur of current) {
    const prev = prevByDay.get(cur.day_of_week)
    if (!prev) continue
    const dayName = DAY_NAMES[cur.day_of_week]

    if (cur.peak_hour !== prev.peak_hour && cur.peak_score > 30) {
      insights.push({
        insight_type: "traffic.peak_shift",
        title: `${competitorName}'s ${dayName} peak shifted`,
        summary: `Peak hour moved from ${formatHour(prev.peak_hour)} to ${formatHour(cur.peak_hour)} on ${dayName}s. This may indicate changes in their hours or offerings.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          competitor_name: competitorName,
          competitor_id: input.competitorId,
          day: dayName,
          previous_peak: prev.peak_hour,
          current_peak: cur.peak_hour,
        },
        recommendations: [],
      })
    }

    for (let h = 0; h < 24; h++) {
      const curScore = cur.hourly_scores[h] ?? 0
      const prevScore = prev.hourly_scores[h] ?? 0
      if (curScore - prevScore >= 20) {
        insights.push({
          insight_type: "traffic.surge",
          title: `${competitorName} traffic surged on ${dayName}s at ${formatHour(h)}`,
          summary: `Traffic at ${formatHour(h)} on ${dayName}s jumped from ${prevScore}% to ${curScore}% (+${curScore - prevScore} points).`,
          confidence: "high",
          severity: "warning",
          evidence: {
            competitor_name: competitorName,
            competitor_id: input.competitorId,
            day: dayName,
            hour: h,
            previous_score: prevScore,
            current_score: curScore,
            delta: curScore - prevScore,
          },
          recommendations: [{
            title: `Consider targeting ${dayName} ${formatHour(h)} with a competing offer`,
            rationale: `${competitorName} is capturing significantly more traffic at this time.`,
          }],
        })
        break
      }
    }

    const curBusyHours = cur.hourly_scores.filter(s => s >= 50).length
    const prevBusyHours = prev.hourly_scores.filter(s => s >= 50).length
    if (curBusyHours > prevBusyHours + 2) {
      insights.push({
        insight_type: "traffic.extended_busy",
        title: `${competitorName} staying busier longer on ${dayName}s`,
        summary: `Busy hours (>50% capacity) increased from ${prevBusyHours} to ${curBusyHours} hours on ${dayName}s.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          competitor_name: competitorName,
          competitor_id: input.competitorId,
          day: dayName,
          previous_busy_hours: prevBusyHours,
          current_busy_hours: curBusyHours,
        },
        recommendations: [],
      })
    }

    const newSlowHours = cur.slow_hours.filter(h => !prev.slow_hours.includes(h))
    if (newSlowHours.length >= 2) {
      insights.push({
        insight_type: "traffic.new_slow_period",
        title: `${competitorName} showing reduced traffic on ${dayName}s`,
        summary: `New slow periods detected at ${newSlowHours.map(formatHour).join(", ")} on ${dayName}s.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          competitor_name: competitorName,
          competitor_id: input.competitorId,
          day: dayName,
          new_slow_hours: newSlowHours,
        },
        recommendations: [{
          title: `Consider a ${dayName} afternoon special`,
          rationale: `Competitor traffic is dropping during these hours — an opportunity to attract their customers.`,
        }],
      })
    }
  }

  return insights
}

export function generateCompetitiveOpportunityInsights(
  allCompetitorTraffic: Array<{ name: string; id: string; days: BusyTimesSnapshot[] }>
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  for (let dow = 0; dow < 7; dow++) {
    for (let h = 8; h < 22; h++) {
      const allSlow = allCompetitorTraffic.every(c => {
        const day = c.days.find(d => d.day_of_week === dow)
        return day && (day.hourly_scores[h] ?? 0) < 25
      })

      if (allSlow && allCompetitorTraffic.length >= 2) {
        insights.push({
          insight_type: "traffic.competitive_opportunity",
          title: `Gap: ${DAY_NAMES[dow]} ${formatHour(h)} — all competitors slow`,
          summary: `All ${allCompetitorTraffic.length} competitors show low traffic on ${DAY_NAMES[dow]}s at ${formatHour(h)}. This is an industry-wide slow period — consider a targeted promotion.`,
          confidence: "medium",
          severity: "info",
          evidence: {
            day: DAY_NAMES[dow],
            hour: h,
            competitor_count: allCompetitorTraffic.length,
          },
          recommendations: [{
            title: `Run a ${DAY_NAMES[dow]} ${formatHour(h)} special`,
            rationale: "When all competitors are slow, a well-timed promotion can capture outsized share.",
          }],
        })
        break
      }
    }
  }

  return insights
}
