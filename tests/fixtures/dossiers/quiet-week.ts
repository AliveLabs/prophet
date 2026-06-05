// Golden dossier: a genuinely quiet week — nothing actionable, only a steady note.
// The engine must produce an HONEST quiet brief, not a fabricated one.

import type { Dossier } from "@/lib/insights/dossier/types"
import { TIER_CAPS } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"

const ruleOutputs: GeneratedInsight[] = [
  {
    insight_type: "seo_organic_visibility_up",
    title: "Organic search is steady and climbing",
    summary: "Your organic visibility is up modestly over the last window. Nothing to act on.",
    confidence: "high",
    severity: "info",
    evidence: { trend: "up", note: "steady" },
    recommendations: [],
  },
]

export const quietWeekDossier: Dossier = {
  locationId: "loc-wagyu",
  dateKey: "2026-06-23",
  generatedAt: "2026-06-23T06:02:00-04:00",
  tier: TIER_CAPS[2],
  profile: {
    locationId: "loc-wagyu",
    name: "Wagyu House Atlanta",
    timezone: "America/New_York",
    voiceTone: "warm_personal",
    attributes: { cuisine: "steakhouse", priceTier: "premium", hasPatio: true, dayparts: ["dinner"] },
    capability: { marketingBudgetBand: "low", whoRunsMarketing: "owner", liveChannels: ["instagram"] },
  },
  location: { entityId: "loc-wagyu", kind: "location", name: "Wagyu House Atlanta" },
  competitors: [{ entityId: "comp-oku", kind: "competitor", name: "O-Ku" }],
  demandCalendar: { events: [], weather: [] },
  ruleOutputs,
}
