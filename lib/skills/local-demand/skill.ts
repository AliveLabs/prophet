// ---------------------------------------------------------------------------
// Local-Demand skill — interprets events + weather into prepare + capitalize plays.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { LOCAL_DEMAND_KNOWLEDGE } from "@/lib/skills/local-demand/knowledge"

// Events + weather are demand drivers. Traffic/hours patterns belong to the Operations skill.
const DEMAND_PREFIXES = ["events.", "weather", "visual.weather", "cross_event"]

function isDemandInsight(insightType: string): boolean {
  return DEMAND_PREFIXES.some((p) => insightType.startsWith(p))
}

function selectInput(d: Dossier) {
  // Token discipline: cap the input so the model's output stays well within limits.
  return {
    events: d.demandCalendar.events.slice(0, 6),
    weather: d.demandCalendar.weather.slice(0, 4),
    demandSignals: d.ruleOutputs.filter((i) => isDemandInsight(i.insight_type)).slice(0, 8),
    ownLocationBusyTimes: d.location.busyTimes ?? null,
  }
}

/** Deterministic, grounded, NUMBER-FREE fallback (so it can never fabricate a figure). */
function fallback(d: Dossier): EnrichedRecommendation[] {
  const demand = d.ruleOutputs.filter((i) => isDemandInsight(i.insight_type)).slice(0, 2)
  const out: EnrichedRecommendation[] = []
  for (const ins of demand) {
    out.push({
      title: "Prepare for the demand this signal points to",
      rationale: `Grounded in ${ins.title}. Get the floor ready before it lands.`,
      skillId: "local-demand",
      ownerRole: "gm",
      kind: "prepare",
      recipe: [
        {
          channel: "in-store / staffing",
          platforms: [],
          audience: "your team for the affected shift",
          window: { note: "ahead of the window in the signal" },
          dependencies: ["staff availability"],
        },
      ],
      confidence: "medium",
      leverage: { label: "medium", basisInternal: "ordinal sizing from the demand signal; no headcount available" },
      evidenceRefs: [ins.insight_type],
      knowledgeVersion: "local-demand@v1",
    })
    out.push({
      title: "Capture the crowd this signal brings",
      rationale: `Grounded in ${ins.title}. Put an offer in front of the right people at the right time.`,
      skillId: "local-demand",
      ownerRole: "marketing",
      kind: "capitalize",
      recipe: [
        {
          channel: "the operator's live social channels",
          platforms: d.tier.socialPlatforms,
          audience: "guests near the venue around the window",
          window: { note: "before and as the window opens" },
          copy: "Right by the action tonight. Come in before or after.",
          creativeDirection: "a warm, inviting shot of the room or a signature plate; no text overlay",
        },
      ],
      confidence: "directional",
      leverage: { label: "medium", basisInternal: "ordinal sizing from the demand signal; no headcount available" },
      evidenceRefs: [ins.insight_type],
      knowledgeVersion: "local-demand@v1",
    })
  }
  return out
}

export const localDemandSkill: ProducerSkill = {
  id: "local-demand",
  displayName: "Local-Demand interpreter (events + weather)",
  ownerRole: "marketing",
  kind: "capitalize",
  tier: "reasoning",
  temperature: 0.5,
  knowledgeVersion: "local-demand@v1",
  knowledge: LOCAL_DEMAND_KNOWLEDGE,
  buildPrompt: (d) => buildSkillPrompt(localDemandSkill, d, selectInput(d)),
  parse: (raw) =>
    coerceEnrichedPlays(raw, { skillId: "local-demand", knowledgeVersion: "local-demand@v1", defaultKind: "capitalize", defaultOwner: "marketing" }),
  fallback,
}
