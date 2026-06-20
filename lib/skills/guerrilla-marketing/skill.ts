// ---------------------------------------------------------------------------
// Guerrilla / Grassroots Marketing skill (P6 expert roster) — the zero-budget,
// hyper-local growth expert. Word of mouth, signage, community partnerships,
// foot-traffic interception. Its OWN category "grassroots" (neutral 1.0 prior), split
// from the Marketing skill (digital/social content cadence) so the operator sees two
// distinct lenses and the synthesis model can tell the plays apart. The craft boundary
// is drawn in the knowledge prose; a future synthesis "play fusion" step (not ranking)
// will MERGE a grassroots + marketing play that land on the same signal into one.
// Runs on the standard reasoning tier (NOT the Opus deep pass).
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { GUERRILLA_KNOWLEDGE } from "@/lib/skills/guerrilla-marketing/knowledge"

// Community / word-of-mouth social signals the grassroots expert can ground on. The broad
// social.* surface (including content-performance signals like top posts / viral content)
// belongs to the Marketing skill; guerrilla reads ONLY the signals about real-world advocacy
// and how the neighborhood perceives the place, matched exactly — this is the craft boundary.
const COMMUNITY_SOCIAL_TYPES = new Set([
  "social.ugc_dominance",
  "social.crowd_perception_gap",
  "social.behind_scenes_opportunity",
])

// Local demand moments + foot-traffic windows are the interception material.
function isGuerrillaSignal(t: string): boolean {
  return t.startsWith("events.") || t.startsWith("traffic.") || COMMUNITY_SOCIAL_TYPES.has(t)
}

function selectInput(d: Dossier) {
  return {
    // LOCAL events (≤~3mi; far events never reach demandCalendar.events) — interception targets.
    // distanceMiles is surfaced so the model honors EVENT_GEOGRAPHY (walk-in ≤0.5mi, local ≤3mi).
    localEvents: d.demandCalendar.events.slice(0, 6).map((e) => ({
      title: e.title,
      when: e.startDatetime,
      venue: e.venue?.name,
      distanceMiles: e.distanceMiles,
      magnitude: e.magnitude,
    })),
    eventSignals: d.ruleOutputs.filter((i) => i.insight_type.startsWith("events.")),
    trafficSignals: d.ruleOutputs.filter((i) => i.insight_type.startsWith("traffic.")),
    communitySignals: d.ruleOutputs.filter((i) => COMMUNITY_SOCIAL_TYPES.has(i.insight_type)),
    // Nearby businesses to partner with / intercept; names only (partnership context).
    nearbyCompetitors: d.competitors.map((c) => c.name),
    serviceModel: d.profile.attributes.serviceModel ?? null,
  }
}

/** Deterministic, grounded, NUMBER-FREE fallback. Emits a grassroots play ONLY when an event,
 *  traffic, or community signal exists to ground it; otherwise nothing. */
function fallback(d: Dossier): EnrichedRecommendation[] {
  const signals = d.ruleOutputs.filter((i) => isGuerrillaSignal(i.insight_type)).slice(0, 2)
  return signals.map((ins) => ({
    title: "Make one zero-budget move in the neighborhood",
    rationale: `Grounded in ${ins.title}. Put yourself in people's path this week with hustle, not spend.`,
    skillId: "guerrilla-marketing",
    ownerRole: "marketing" as const,
    kind: "capitalize" as const,
    recipe: [
      {
        channel: "the sidewalk / a nearby partner",
        platforms: [],
        audience: "people already passing by or part of a nearby group",
        window: { note: "this week, tied to the moment in the signal" },
        dependencies: ["about an hour of the owner's time", "a marker and paper (no print budget needed)"],
      },
    ],
    confidence: "directional" as const,
    leverage: { label: "medium" as const, basisInternal: "grassroots reach sized ordinally; no turnout figure available" },
    evidenceRefs: [ins.insight_type],
    knowledgeVersion: "guerrilla@v1",
  }))
}

export const guerrillaMarketingSkill: ProducerSkill = {
  id: "guerrilla-marketing",
  displayName: "Guerrilla & grassroots marketing expert",
  ownerRole: "marketing",
  kind: "capitalize",
  category: "grassroots",
  tier: "reasoning",
  temperature: 0.6,
  knowledgeVersion: "guerrilla@v1",
  knowledge: GUERRILLA_KNOWLEDGE,
  buildPrompt: (d) => buildSkillPrompt(guerrillaMarketingSkill, d, selectInput(d)),
  parse: (raw) =>
    coerceEnrichedPlays(raw, { skillId: "guerrilla-marketing", knowledgeVersion: "guerrilla@v1", defaultKind: "capitalize", defaultOwner: "marketing" }),
  fallback,
}
