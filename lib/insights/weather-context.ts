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
    "review_velocity",
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

export function generateWeatherCrossSignals(
  weather: WeatherContext,
  hasPatioPhotos: boolean,
  competitorName?: string
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!weather.today) return insights

  if (
    weather.today.temp_high_f >= 75 &&
    !weather.today.is_severe &&
    weather.today.precipitation_in < 0.1 &&
    hasPatioPhotos
  ) {
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
