"use client"

import type { WeatherDay } from "./weather-history"

type ActionableInsight = {
  icon: string
  title: string
  summary: string
  severity: "critical" | "warning" | "info" | "positive"
  actions: string[]
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-destructive/30 bg-destructive/10",
  warning: "border-signal-gold/30 bg-signal-gold/10",
  info: "border-primary/30 bg-primary/10",
  positive: "border-precision-teal/30 bg-precision-teal/10",
}

const SEVERITY_ICON_COLORS: Record<string, string> = {
  critical: "text-destructive",
  warning: "text-signal-gold",
  info: "text-primary",
  positive: "text-precision-teal",
}

function generateWeatherActionableInsights(
  days: WeatherDay[]
): ActionableInsight[] {
  const insights: ActionableInsight[] = []
  const forecast = days.filter((d) => d.isForecast).sort((a, b) => a.date.localeCompare(b.date))
  const historical = days.filter((d) => !d.isForecast).sort((a, b) => b.date.localeCompare(a.date))

  if (forecast.length === 0 && historical.length === 0) return insights

  // Cold snap detection: forecast shows temps dropping below 40F
  const coldDays = forecast.filter((d) => d.temp_low_f < 40)
  if (coldDays.length >= 2) {
    const lowestTemp = Math.min(...coldDays.map((d) => d.temp_low_f))
    insights.push({
      icon: "cold",
      title: "Cold Snap Approaching",
      summary: `${coldDays.length} upcoming days with lows below 40°F (lowest: ${Math.round(lowestTemp)}°F). Expect reduced foot traffic and higher demand for warm items.`,
      severity: "warning",
      actions: [
        "Increase hot beverage and soup stock",
        "Consider adding heat lamps or space heaters to outdoor areas",
        "Promote warm comfort food specials on social media",
        "Adjust staffing down for expected slower periods",
      ],
    })
  }

  // Rain streak: 3+ consecutive rainy/snowy forecast days
  let rainStreak = 0
  let maxRainStreak = 0
  for (const d of forecast) {
    const cond = (d.weather_condition ?? "").toLowerCase()
    if (cond.includes("rain") || cond.includes("drizzle") || cond.includes("snow") || cond.includes("storm") || d.precipitation_in > 0.2) {
      rainStreak++
      maxRainStreak = Math.max(maxRainStreak, rainStreak)
    } else {
      rainStreak = 0
    }
  }
  if (maxRainStreak >= 3) {
    insights.push({
      icon: "rain",
      title: "Extended Rain Ahead",
      summary: `${maxRainStreak} consecutive rainy days in the forecast. Walk-in traffic typically drops 15-30% during prolonged wet weather.`,
      severity: "warning",
      actions: [
        "Boost delivery/takeout promotions and partnerships",
        "Ensure delivery packaging is rain-proof",
        "Run rainy-day specials to incentivize dine-in visits",
        "Focus social media on cozy indoor atmosphere",
      ],
    })
  }

  // Weekend warmth opportunity: upcoming Sat/Sun is warm (>70F) and clear
  const weekendDays = forecast.filter((d) => {
    const dow = new Date(d.date + "T12:00:00Z").getDay()
    return dow === 0 || dow === 6
  })
  const warmWeekendDays = weekendDays.filter(
    (d) => d.temp_high_f >= 70 && d.precipitation_in < 0.1 && !d.is_severe
  )
  if (warmWeekendDays.length > 0) {
    const warmDay = warmWeekendDays[0]
    const dayName = new Date(warmDay.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long" })
    insights.push({
      icon: "sun",
      title: `Beautiful ${dayName} Forecast`,
      summary: `${dayName} is looking ${Math.round(warmDay.temp_high_f)}°F and ${warmDay.weather_condition?.toLowerCase() ?? "clear"}. Perfect conditions for outdoor dining and higher walk-in traffic.`,
      severity: "positive",
      actions: [
        "Open and prepare patio/outdoor seating early",
        "Schedule additional weekend staff",
        "Post outdoor dining photos to social media",
        "Plan outdoor-friendly specials or live entertainment",
      ],
    })
  }

  // Temperature trend shift: significant change week-over-week
  if (historical.length >= 14) {
    const recentWeek = historical.slice(0, 7)
    const previousWeek = historical.slice(7, 14)
    const recentAvg = recentWeek.reduce((s, d) => s + d.temp_high_f, 0) / recentWeek.length
    const previousAvg = previousWeek.reduce((s, d) => s + d.temp_high_f, 0) / previousWeek.length
    const diff = recentAvg - previousAvg

    if (Math.abs(diff) >= 10) {
      const direction = diff > 0 ? "warming" : "cooling"
      insights.push({
        icon: "trend",
        title: `Seasonal ${direction === "warming" ? "Warming" : "Cooling"} Trend`,
        summary: `Average high temps shifted ${Math.abs(Math.round(diff))}°F ${direction} this week vs. last. Seasonal transitions impact both menu preferences and traffic patterns.`,
        severity: "info",
        actions: direction === "warming"
          ? [
              "Rotate menu toward lighter, seasonal items (salads, cold drinks)",
              "Feature refreshing beverages and frozen desserts",
              "Prepare outdoor seating for increased demand",
            ]
          : [
              "Feature hearty, warming menu items (soups, stews, hot drinks)",
              "Stock up on seasonal comfort food ingredients",
              "Promote cozy indoor ambiance in marketing",
            ],
      })
    }
  }

  // Severe weather upcoming
  const severeForecast = forecast.filter((d) => d.is_severe)
  if (severeForecast.length > 0) {
    const severeDate = severeForecast[0]
    const dayName = new Date(severeDate.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    insights.push({
      icon: "alert",
      title: "Severe Weather Warning",
      summary: `Severe conditions forecast for ${dayName}: ${severeDate.weather_condition ?? "severe weather"} with high of ${Math.round(severeDate.temp_high_f)}°F.`,
      severity: "critical",
      actions: [
        "Confirm delivery partner availability and adjust expectations",
        "Prepare for potential early closing or reduced hours",
        "Pre-communicate any changes to customers via social/email",
        "Ensure staff safety plans are in place",
      ],
    })
  }

  return insights
}

export default function WeatherActionableInsights({
  days,
}: {
  days: WeatherDay[]
  todayStr?: string
}) {
  const insights = generateWeatherActionableInsights(days)
  if (insights.length === 0) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h3 className="text-sm font-bold text-foreground">What This Means for Your Business</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Actionable recommendations based on weather data and forecast</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {insights.map((insight, idx) => (
          <div
            key={idx}
            className={`rounded-xl border p-4 ${SEVERITY_STYLES[insight.severity]}`}
          >
            <div className="flex items-start gap-2.5">
              <div className={`mt-0.5 ${SEVERITY_ICON_COLORS[insight.severity]}`}>
                <InsightIcon type={insight.icon} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{insight.summary}</p>
                <div className="mt-3 space-y-1.5">
                  {insight.actions.map((action, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <svg className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      <span className="text-[11px] text-foreground">{action}</span>
                    </div>
                  ))}
                </div>
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
    case "cold":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m0-18l-3 3m3-3l3 3M12 21l-3-3m3 3l3-3M3 12h18M3 12l3-3m-3 3l3 3M21 12l-3-3m3 3l-3 3" />
        </svg>
      )
    case "rain":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
        </svg>
      )
    case "sun":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      )
    case "alert":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
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
