import type { GeneratedInsight } from "./types"
import type { DailyWeatherSummary } from "@/lib/providers/openweathermap"

export type WeatherContext = {
  today: DailyWeatherSummary | null
  yesterday: DailyWeatherSummary | null
  weekAvg: { temp_high_f: number; precipitation_in: number } | null
}

export function shouldSuppressInsight(
  insight: GeneratedInsight,
  weather: WeatherContext
): boolean {
  if (!weather.today?.is_severe) return false

  const trafficDeclineTypes = [
    "traffic.surge",
    "traffic.new_slow_period",
    "traffic.extended_busy",
    "review_velocity_falling",
    "review_velocity_rising",
  ]
  return trafficDeclineTypes.includes(insight.insight_type) &&
    insight.severity !== "critical"
}

export function addWeatherContext(
  insight: GeneratedInsight,
  weather: WeatherContext
): GeneratedInsight {
  if (!weather.today) return insight

  const weatherTag = weather.today.is_severe
    ? "weather_adjusted"
    : "weather_context"

  return {
    ...insight,
    evidence: {
      ...insight.evidence,
      weather_condition: weather.today.weather_condition,
      weather_temp_high: weather.today.temp_high_f,
      weather_is_severe: weather.today.is_severe,
      weather_tag: weatherTag,
    },
  }
}

// A patio is genuinely appealing in a COMFORTABLE band — not too cold, and NOT a heatwave
// (nobody sits on a 100°F patio). The old gate (>=75°F, no upper bound) fired every warm day
// AND on miserable 100°F heatwave days. Pure + testable.
const PATIO_MIN_F = 62
const PATIO_MAX_F = 88
export function isPatioFavorable(d: DailyWeatherSummary | null | undefined): boolean {
  if (!d) return false
  return d.temp_high_f >= PATIO_MIN_F && d.temp_high_f <= PATIO_MAX_F && !d.is_severe && d.precipitation_in < 0.1
}

export function generateWeatherCrossSignals(
  weather: WeatherContext,
  hasPatioPhotos: boolean,
  competitorName?: string
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!weather.today) return insights

  // Fire the patio opportunity ONLY when today is genuinely patio-pleasant AND it's a NOTABLE day —
  // a pleasant break from recent conditions — not merely "warm". Ordinary seasonal heat (a hot-climate
  // summer) is not a headline (Bryan: "we have heat in Texas, but that's not new"). Notability =
  // today pleasant while the 7-day baseline was NOT, or while yesterday was not patio weather (a break).
  // With no baseline at all we stay silent rather than spam "it's nice out" every day.
  const wk = weather.weekAvg
  const notableVsWeek =
    wk != null && (wk.temp_high_f > PATIO_MAX_F + 4 || wk.temp_high_f < PATIO_MIN_F - 4 || wk.precipitation_in >= 0.1)
  const notableVsYesterday = weather.yesterday != null && !isPatioFavorable(weather.yesterday)
  const haveBaseline = wk != null || weather.yesterday != null

  if (isPatioFavorable(weather.today) && hasPatioPhotos && haveBaseline && (notableVsWeek || notableVsYesterday)) {
    insights.push({
      insight_type: "visual.weather_patio",
      title: competitorName
        ? `${competitorName} has patio photos during warm weather`
        : "Warm weather patio opportunity",
      summary: `Current conditions are ${Math.round(weather.today.temp_high_f)}°F and ${weather.today.weather_condition.toLowerCase()}. ${
        competitorName
          ? `${competitorName} features outdoor dining photos — consider promoting your own patio.`
          : "Great weather for outdoor dining promotions."
      }`,
      confidence: "medium",
      severity: "info",
      evidence: {
        weather_condition: weather.today.weather_condition,
        temp_high: weather.today.temp_high_f,
        has_patio_photos: hasPatioPhotos,
        competitor_name: competitorName ?? null,
      },
      recommendations: [{
        title: "Highlight outdoor dining options",
        rationale: "Update your photos and social media to feature patio availability during this warm stretch.",
      }],
    })
  }

  if (weather.today.is_severe) {
    insights.push({
      insight_type: "traffic.weather_suppression",
      title: "Severe weather — traffic insights adjusted",
      summary: `${weather.today.weather_condition} conditions today (${Math.round(weather.today.temp_high_f)}°F, ${weather.today.precipitation_in}" precipitation). Traffic declines during this period are weather-driven, not competitive.`,
      confidence: "high",
      severity: "info",
      evidence: {
        weather_condition: weather.today.weather_condition,
        temp_high: weather.today.temp_high_f,
        precipitation: weather.today.precipitation_in,
        is_severe: true,
      },
      recommendations: [{
        title: "Focus on delivery and indoor experience",
        rationale: "During severe weather, emphasize delivery options and cozy atmosphere in your messaging.",
      }],
    })
  }

  return insights
}
