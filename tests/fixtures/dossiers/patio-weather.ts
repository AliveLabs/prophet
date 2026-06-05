// Golden dossier: a clear warm weekend, patio-forward steakhouse.

import type { Dossier } from "@/lib/insights/dossier/types"
import { TIER_CAPS } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { DailyWeatherSummary } from "@/lib/providers/openweathermap"

const sunny: DailyWeatherSummary = {
  date: "2026-06-19",
  temp_high_f: 78,
  temp_low_f: 61,
  feels_like_high_f: 78,
  humidity_avg: 40,
  wind_speed_max_mph: 6,
  weather_condition: "Clear",
  weather_description: "clear sky",
  weather_icon: "01d",
  precipitation_in: 0,
  is_severe: false,
}

const ruleOutputs: GeneratedInsight[] = [
  {
    insight_type: "visual.weather_patio",
    title: "Patio weather all weekend: clear and warm",
    summary: "A clear, warm, low-wind weekend lines up with your outdoor seating.",
    confidence: "medium",
    severity: "info",
    evidence: { condition: "Clear", high_f: 78, has_patio: true, days: ["Fri", "Sat", "Sun"] },
    recommendations: [{ title: "Lean into the patio", rationale: "Weather matches your strength." }],
  },
]

export const patioWeatherDossier: Dossier = {
  locationId: "loc-wagyu",
  dateKey: "2026-06-19",
  generatedAt: "2026-06-19T06:02:00-04:00",
  tier: TIER_CAPS[2],
  profile: {
    locationId: "loc-wagyu",
    name: "Wagyu House Atlanta",
    timezone: "America/New_York",
    voiceTone: "warm_personal",
    attributes: { cuisine: "steakhouse", priceTier: "premium", hasPatio: true, dayparts: ["dinner"] },
    capability: { marketingBudgetBand: "low", whoRunsMarketing: "owner", liveChannels: ["instagram"], posCapabilities: ["reservations"], seats: 90 },
  },
  location: { entityId: "loc-wagyu", kind: "location", name: "Wagyu House Atlanta" },
  competitors: [{ entityId: "comp-oku", kind: "competitor", name: "O-Ku" }],
  demandCalendar: { events: [], weather: [sunny] },
  ruleOutputs,
}
