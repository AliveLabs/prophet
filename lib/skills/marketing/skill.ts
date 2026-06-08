// ---------------------------------------------------------------------------
// Marketing / Campaign skill — ongoing social/content campaigns grounded in social rules.
// (Event/weather-triggered demand is the Local-Demand skill's job.)
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { MARKETING_KNOWLEDGE } from "@/lib/skills/marketing/knowledge"

function isSocialInsight(t: string): boolean {
  return t.startsWith("social.")
}

function selectInput(d: Dossier) {
  return {
    socialSignals: d.ruleOutputs.filter((i) => isSocialInsight(i.insight_type)),
    ownSocial: d.location.social ?? null,
    ownVisual: d.location.visual ?? null,
    competitorSocial: d.competitors.map((c) => ({ name: c.name, social: c.social ?? null, visual: c.visual ?? null })),
  }
}

/** Deterministic, grounded, number-free fallback. */
function fallback(d: Dossier): EnrichedRecommendation[] {
  const signals = d.ruleOutputs.filter((i) => isSocialInsight(i.insight_type)).slice(0, 2)
  return signals.map((ins) => ({
    title: "Tighten your content plan to match what is working",
    rationale: `Grounded in ${ins.title}. Post the formats that earn engagement, on a cadence you can keep.`,
    skillId: "marketing",
    ownerRole: "marketing" as const,
    kind: "capitalize" as const,
    recipe: [
      {
        channel: "your live social channels",
        platforms: d.tier.socialPlatforms,
        audience: "locals who follow you and look-alikes nearby",
        window: { note: "this week, on a repeatable cadence" },
        creativeDirection: "on your phone, capture the format the signal says is winning (a short vertical video for Instagram/TikTok, or one clear photo for the feed); shoot in daylight, no fancy setup",
        dependencies: ["your phone", "about 15 minutes per post"],
      },
    ],
    confidence: "medium" as const,
    leverage: { label: "medium" as const, basisInternal: "engagement upside sized ordinally from the social gap" },
    evidenceRefs: [ins.insight_type],
    knowledgeVersion: "marketing@v1",
  }))
}

export const marketingSkill: ProducerSkill = {
  id: "marketing",
  displayName: "Marketing & Campaign expert",
  ownerRole: "marketing",
  kind: "capitalize",
  tier: "reasoning",
  temperature: 0.6,
  knowledgeVersion: "marketing@v1",
  knowledge: MARKETING_KNOWLEDGE,
  buildPrompt: (d) => buildSkillPrompt(marketingSkill, d, selectInput(d)),
  parse: (raw) =>
    coerceEnrichedPlays(raw, { skillId: "marketing", knowledgeVersion: "marketing@v1", defaultKind: "capitalize", defaultOwner: "marketing" }),
  fallback,
}
