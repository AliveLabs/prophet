// ---------------------------------------------------------------------------
// Positioning & Pricing skill — menu/value moves grounded in pricing + content rules.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { POSITIONING_KNOWLEDGE } from "@/lib/skills/positioning/knowledge"

const POS_PREFIXES = ["menu.", "content.", "seo_competitor"]

function isPositioningInsight(t: string): boolean {
  return POS_PREFIXES.some((p) => t.startsWith(p))
}

function selectInput(d: Dossier) {
  return {
    pricingSignals: d.ruleOutputs.filter((i) => isPositioningInsight(i.insight_type)),
    ownMenu: d.location.menu ?? null,
    ownFeatures: d.location.features ?? null,
    competitorMenus: d.competitors.map((c) => ({ name: c.name, menu: c.menu ?? null, features: c.features ?? null })),
  }
}

/** Deterministic, grounded, NUMBER-FREE fallback. Brand-aware: premium places position on quality. */
function fallback(d: Dossier): EnrichedRecommendation[] {
  const signals = d.ruleOutputs.filter((i) => isPositioningInsight(i.insight_type)).slice(0, 2)
  const tier = (d.profile.attributes.priceTier ?? "").toLowerCase()
  const premium = tier.includes("premium") || tier.includes("upscale") || tier.includes("fine")
  return signals.map((ins) =>
    premium
      ? {
          title: "Answer the undercut with quality, not a discount",
          rationale: `Grounded in ${ins.title}. You are the premium option; lean into the cut, the room, and your rating rather than chasing a cheaper rival.`,
          skillId: "positioning",
          ownerRole: "owner" as const,
          kind: "positioning" as const,
          recipe: [
            {
              channel: "menu wording + Google Business + your social",
              platforms: d.tier.socialPlatforms,
              audience: "diners choosing where the occasion is worth it",
              window: { note: "ongoing" },
              creativeDirection: "on your phone, take a few photos that show why the price is worth it: a signature dish leaving the kitchen and the room when it's full; pick the best one",
              dependencies: ["menu/site copy refresh"],
            },
          ],
          confidence: "medium" as const,
          leverage: { label: "medium" as const, basisInternal: "defends premium position; sized ordinally from the pricing gap" },
          evidenceRefs: [ins.insight_type],
          knowledgeVersion: "positioning@v1",
        }
      : {
          title: "Add a value entry point, do not start a price war",
          rationale: `Grounded in ${ins.title}. Enter the comparison with one lower-priced item; hold your dinner pricing.`,
          skillId: "positioning",
          ownerRole: "owner" as const,
          kind: "positioning" as const,
          recipe: [
            {
              channel: "menu + Google Business + your social",
              platforms: d.tier.socialPlatforms,
              audience: "midday searchers and value-comparing diners",
              window: { note: "before the weekend" },
              creativeDirection: "a clear phone photo of the new value dish in daylight; give it a name people would search for",
              dependencies: ["menu update", "POS can ring the new item"],
            },
          ],
          confidence: "medium" as const,
          leverage: { label: "medium" as const, basisInternal: "comparison-set entry; sized ordinally from the pricing gap" },
          evidenceRefs: [ins.insight_type],
          knowledgeVersion: "positioning@v1",
        },
  )
}

export const positioningSkill: ProducerSkill = {
  id: "positioning",
  displayName: "Positioning & Pricing expert",
  ownerRole: "owner",
  kind: "positioning",
  tier: "reasoning",
  temperature: 0.4,
  knowledgeVersion: "positioning@v1",
  knowledge: POSITIONING_KNOWLEDGE,
  buildPrompt: (d) => buildSkillPrompt(positioningSkill, d, selectInput(d)),
  parse: (raw) =>
    coerceEnrichedPlays(raw, { skillId: "positioning", knowledgeVersion: "positioning@v1", defaultKind: "positioning", defaultOwner: "owner" }),
  fallback,
}
