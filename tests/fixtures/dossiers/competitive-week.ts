// Golden dossier: a competitive week — social, review, and pricing signals (no events).
// Exercises the Marketing, Reputation, and Positioning skills.

import type { Dossier } from "@/lib/insights/dossier/types"
import { TIER_CAPS } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"

const ruleOutputs: GeneratedInsight[] = [
  {
    insight_type: "social.content_type_opportunity",
    title: "O-Ku's plated-entree posts are outperforming",
    summary: "A competitor's entree-only posts earn far more engagement than their other formats.",
    confidence: "high",
    severity: "info",
    evidence: { competitor: "O-Ku", winning_format: "plated entrees", note: "well above their feed average" },
    recommendations: [{ title: "Post entrees", rationale: "Match the format that wins." }],
  },
  {
    insight_type: "social.posting_frequency_gap",
    title: "You post far less often than your rivals",
    summary: "Your posting cadence trails the watched set.",
    confidence: "high",
    severity: "warning",
    evidence: { your_cadence: "low", competitor_cadence: "daily" },
    recommendations: [{ title: "Set a cadence", rationale: "Show up consistently." }],
  },
  {
    insight_type: "review_velocity_falling",
    title: "Your review velocity is slipping behind a rival",
    summary: "A competitor is gathering new reviews faster than you are.",
    confidence: "medium",
    severity: "info",
    evidence: { competitor: "Bachi Box", trend: "their velocity up" },
    recommendations: [{ title: "Ask for reviews", rationale: "Close the velocity gap." }],
  },
  // An own-review complaint theme (shape mirrors reviewInsightsFromSentiment). reputation@v2's
  // floor only fires on an unambiguous own-failure signal — v1's floor fired off the
  // competitor-scoped velocity row above via misattribution, which is the defect v2 fixes —
  // so the golden needs the signal a real competitive week carries once review sentiment runs.
  {
    insight_type: "review.theme",
    title: "Review theme: slow service (negative)",
    summary: 'Customers are raising "slow service" as a problem.',
    confidence: "medium",
    severity: "warning",
    evidence: {
      theme: "slow service",
      sentiment: "negative",
      mentions: 6,
      examples: ["Waited forty minutes for two entrees on a half-empty night."],
      windowDays: 90,
    },
    recommendations: [],
  },
  {
    insight_type: "menu.price_positioning_shift",
    title: "Bachi Box sits well under your dine-in check",
    summary: "A nearby competitor averages a much lower dine-in check.",
    confidence: "high",
    severity: "warning",
    evidence: { competitor: "Bachi Box", their_avg: 12.11, your_avg: 19.99 },
    recommendations: [{ title: "Add a value entry point", rationale: "Enter the comparison." }],
  },
]

export const competitiveWeekDossier: Dossier = {
  locationId: "loc-wagyu",
  dateKey: "2026-06-09",
  generatedAt: "2026-06-09T06:02:00-04:00",
  tier: TIER_CAPS[2],
  profile: {
    locationId: "loc-wagyu",
    name: "Wagyu House Atlanta",
    timezone: "America/New_York",
    voiceTone: "warm_personal",
    attributes: { cuisine: "steakhouse", priceTier: "premium", hasPatio: true, dayparts: ["dinner"] },
    capability: { marketingBudgetBand: "low", whoRunsMarketing: "owner", liveChannels: ["instagram", "google_business"], posCapabilities: ["reservations"], seats: 90 },
  },
  location: { entityId: "loc-wagyu", kind: "location", name: "Wagyu House Atlanta" },
  competitors: [
    { entityId: "comp-oku", kind: "competitor", name: "O-Ku" },
    { entityId: "comp-bachi", kind: "competitor", name: "Bachi Box" },
  ],
  demandCalendar: { events: [], weather: [] },
  ruleOutputs,
}
