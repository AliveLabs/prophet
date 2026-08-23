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

// ── ALT-769: severe weather is not always COLD ──────────────────────────────
//
// The advice was one fixed string: "emphasize delivery options and cozy atmosphere". On a 105°F
// Texas afternoon "cozy" is the opposite of what anyone wants, and it is the kind of line that
// tells an operator we have never seen their restaurant. Every `is_severe` day in prod so far has
// been HEAT, so the only advice we shipped was the only one that could not apply.
//
// Branching on the temperature rather than on a season or a region: `is_severe` covers heat, cold,
// storms and wind, and the operator can be in any of them.
const SEVERE_HEAT_F = 95
const SEVERE_COLD_F = 40

export function severeWeatherAdvice(
  d: Pick<DailyWeatherSummary, "temp_high_f" | "precipitation_in">,
): { title: string; rationale: string } {
  // Precipitation first: a wet day is a wet day whatever the temperature, and it is the case where
  // "stay in" is genuinely the message.
  if (d.precipitation_in >= 0.25) {
    return {
      title: "Lead with delivery and pickup",
      rationale:
        "Wet weather moves demand off the street and onto phones. Push delivery and curbside, and make sure your hours and pickup instructions are current.",
    }
  }
  if (d.temp_high_f >= SEVERE_HEAT_F) {
    return {
      title: "Lead with cold drinks, shade and delivery",
      rationale:
        "In heat this severe the patio is a liability, not an asset. Promote iced drinks and lighter dishes, say plainly that the dining room is air-conditioned, and lean on delivery for the afternoon.",
    }
  }
  if (d.temp_high_f <= SEVERE_COLD_F) {
    return {
      title: "Lead with warm food and delivery",
      rationale:
        "Cold keeps people home. Push soups and hot dishes, make the dining room sound worth the trip, and expect delivery to carry the day.",
    }
  }
  // Severe but neither hot nor cold: wind, storms, air quality. Say the true, general thing.
  return {
    title: "Lead with delivery and indoor seating",
    rationale:
      "Conditions like this keep walk-ins down whatever the temperature. Push delivery and pickup, and keep your hours current so nobody makes a trip for nothing.",
  }
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
      // ALT-724: this is `temp_high_f` off a DAY-SUMMARY forecast row, so it is the day's high, not
      // a reading for right now. An operator checking a thermometer at 9am would find us wrong.
      summary: `Today should reach ${Math.round(weather.today.temp_high_f)}°F and ${weather.today.weather_condition.toLowerCase()}. ${
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
    const advice = severeWeatherAdvice(weather.today)
    insights.push({
      insight_type: "traffic.weather_suppression",
      title: "Severe weather is driving today’s traffic, not competitors",
      // ALT-768: "conditions today (108°F)" read as a MEASUREMENT of today, and it is not: this is
      // a forecast high captured at ~06:30 that morning. Measured in prod on Raising Cane's, the
      // forecast ran 1.1 to 2.2°F hotter than the eventual observation on 4 of 5 days. So the
      // number was not wrong so much as the sentence was: "should reach" is what we can support.
      // The patio insight above already phrased it this way; this one did not.
      summary: `${weather.today.weather_condition} conditions today: it should reach ${Math.round(weather.today.temp_high_f)}°F with ${weather.today.precipitation_in}" precipitation forecast. Traffic declines during this period are weather-driven, not competitive.`,
      confidence: "high",
      severity: "info",
      evidence: {
        weather_condition: weather.today.weather_condition,
        temp_high: weather.today.temp_high_f,
        // ALT-768: name what this number IS. `location_weather` holds ONE row per (location, date)
        // and it is written twice with two different meanings: a forecast on the day, then an
        // observation when the next day's run fetches "yesterday". So the row a reader compares
        // against later is not the number this insight quoted, and nothing said so.
        temp_source: "forecast",
        precipitation: weather.today.precipitation_in,
        is_severe: true,
      },
      recommendations: [{
        title: advice.title,
        rationale: advice.rationale,
      }],
    })
  }

  return insights
}
