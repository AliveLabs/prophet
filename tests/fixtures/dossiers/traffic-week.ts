// Golden dossier: T1 — the traffic diff family armed (previous-snapshot wiring lands).
// Carries one warning-grade traffic.surge (a named rival's window, full evidence keys)
// and two info-grade traffic.baseline rows. Exercises:
//   - operations@v2's rival-shift floor (fires ONE grounded, voice-clean, fix-stance play)
//   - marketing@v2's rhythm family (must NOT fire off the surge — only off
//     traffic.competitive_opportunity, which this fixture deliberately omits, so the
//     assertion is "marketing contributes zero rhythm plays grounded on the surge").
// location.busyTimes is populated (own-curve ground truth both skills' playbooks read).

import type { Dossier } from "@/lib/insights/dossier/types"
import { TIER_CAPS } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"

const ruleOutputs: GeneratedInsight[] = [
  {
    insight_type: "traffic.surge",
    title: "O-Ku traffic surged on Fridays at 7pm",
    summary: "Traffic at 7pm on Fridays jumped from 40% to 75% (+35 points).",
    confidence: "high",
    severity: "warning",
    evidence: {
      competitor_name: "O-Ku",
      competitor_id: "comp-oku",
      day: "Friday",
      hour: 19,
      previous_score: 40,
      current_score: 75,
      delta: 35,
    },
    recommendations: [
      {
        title: "Consider targeting Friday 7pm with a competing offer",
        rationale: "O-Ku is capturing significantly more traffic at this time.",
      },
    ],
  },
  {
    insight_type: "traffic.baseline",
    title: "O-Ku traffic patterns captured",
    summary: "Peak times: Friday at 7pm (75%), Saturday at 8pm (70%), Sunday at 6pm (55%). Future updates will detect changes.",
    confidence: "medium",
    severity: "info",
    evidence: {
      competitor_name: "O-Ku",
      competitor_id: "comp-oku",
      peaks: [
        { day: "Friday", hour: 19, score: 75 },
        { day: "Saturday", hour: 20, score: 70 },
        { day: "Sunday", hour: 18, score: 55 },
      ],
      typical_time_spent: "1-2 hr",
    },
    recommendations: [],
  },
  {
    insight_type: "traffic.baseline",
    title: "Bachi Box traffic patterns captured",
    summary: "Peak times: Friday at 8pm (60%), Saturday at 7pm (58%), Sunday at 5pm (45%). Future updates will detect changes.",
    confidence: "medium",
    severity: "info",
    evidence: {
      competitor_name: "Bachi Box",
      competitor_id: "comp-bachi",
      peaks: [
        { day: "Friday", hour: 20, score: 60 },
        { day: "Saturday", hour: 19, score: 58 },
        { day: "Sunday", hour: 17, score: 45 },
      ],
      typical_time_spent: "30-45 min",
    },
    recommendations: [],
  },
]

export const trafficWeekDossier: Dossier = {
  locationId: "loc-wagyu",
  dateKey: "2026-07-03",
  generatedAt: "2026-07-03T06:02:00-04:00",
  tier: TIER_CAPS[2],
  profile: {
    locationId: "loc-wagyu",
    name: "Wagyu House Atlanta",
    timezone: "America/New_York",
    voiceTone: "warm_personal",
    attributes: { cuisine: "steakhouse", priceTier: "premium", hasPatio: true, dayparts: ["dinner"] },
    capability: { marketingBudgetBand: "low", whoRunsMarketing: "owner", liveChannels: ["instagram", "google_business"], posCapabilities: ["reservations"], seats: 90 },
  },
  location: {
    entityId: "loc-wagyu",
    kind: "location",
    name: "Wagyu House Atlanta",
    busyTimes: {
      competitor_id: "loc-wagyu",
      days: [
        { day_of_week: 5, day_name: "Friday", hourly_scores: Array(24).fill(0).map((_, h) => (h === 19 ? 65 : 20)), peak_hour: 19, peak_score: 65, slow_hours: [2, 3, 4] },
        { day_of_week: 6, day_name: "Saturday", hourly_scores: Array(24).fill(0).map((_, h) => (h === 20 ? 70 : 22)), peak_hour: 20, peak_score: 70, slow_hours: [2, 3, 4] },
      ],
      typical_time_spent: "1-2 hr",
      current_popularity: 55,
      working_hours_lines: null,
    },
  },
  competitors: [
    { entityId: "comp-oku", kind: "competitor", name: "O-Ku" },
    { entityId: "comp-bachi", kind: "competitor", name: "Bachi Box" },
  ],
  demandCalendar: { events: [], weather: [] },
  ruleOutputs,
}
