// A real manufactured golden dossier: Wagyu House, the arena-weekend scenario.
// Used to verify the engine end-to-end deterministically (no live calls).

import type { Dossier, EntitySignals } from "@/lib/insights/dossier/types"
import { TIER_CAPS } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { NormalizedEvent } from "@/lib/events/types"

const arenaEvent: NormalizedEvent = {
  uid: "evt-statefarm-fri",
  title: "Sold-out show at State Farm Arena",
  startDatetime: "2026-06-26T19:00:00-04:00",
  venue: { name: "State Farm Arena", address: "1 State Farm Dr, Atlanta, GA" },
  ticketsAndInfo: [
    { title: "TICKETS", domain: "ticketmaster.com" },
    { title: "TICKETS", domain: "seatgeek.com" },
  ],
  source: "dataforseo_google_events",
  keyword: "concerts atlanta",
  dateRange: "week",
}

const ruleOutputs: GeneratedInsight[] = [
  {
    insight_type: "events.new_high_signal_event",
    title: "High-signal event Friday: a sold-out arena show half a mile out",
    summary: "A major ticketed event lands Friday night within your dinner blocks.",
    confidence: "high",
    severity: "info",
    evidence: { venue: "State Farm Arena", ticket_sources: 2, distance_mi: 0.5, day: "Friday" },
    recommendations: [{ title: "Target attendees before the show", rationale: "Pre-show dinner window." }],
  },
  {
    insight_type: "menu.price_positioning_shift",
    title: "Bachi Box sits well under your dine-in check",
    summary: "A nearby competitor averages a much lower dine-in check than you.",
    confidence: "high",
    severity: "warning",
    evidence: { competitor: "Bachi Box", their_avg: 12.11, your_avg: 19.99 },
    recommendations: [{ title: "Add a value entry point", rationale: "Enter the comparison set." }],
  },
]

const ownLocation: EntitySignals = {
  entityId: "loc-wagyu",
  kind: "location",
  name: "Wagyu House Atlanta",
}

export const arenaWeekDossier: Dossier = {
  locationId: "loc-wagyu",
  dateKey: "2026-06-26",
  generatedAt: "2026-06-26T06:02:00-04:00",
  tier: TIER_CAPS[2],
  profile: {
    locationId: "loc-wagyu",
    name: "Wagyu House Atlanta",
    timezone: "America/New_York",
    voiceTone: "warm_personal",
    voiceSample: "Wagyu, the way it should be.",
    attributes: { cuisine: "steakhouse", priceTier: "premium", hasPatio: true, nearVenues: ["State Farm Arena"], dayparts: ["dinner"] },
    capability: { marketingBudgetBand: "low", whoRunsMarketing: "owner", liveChannels: ["instagram", "google_business"], posCapabilities: ["reservations"], seats: 90 },
  },
  location: ownLocation,
  competitors: [
    { entityId: "comp-bachi", kind: "competitor", name: "Bachi Box" },
    { entityId: "comp-oku", kind: "competitor", name: "O-Ku" },
  ],
  demandCalendar: { events: [arenaEvent], weather: [] },
  ruleOutputs,
}
