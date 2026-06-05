// ---------------------------------------------------------------------------
// Reputation / Reviews skill — review themes, reply strategy, review-velocity asks.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { REPUTATION_KNOWLEDGE } from "@/lib/skills/reputation/knowledge"

const REP_PREFIXES = ["rating", "review"]

function isReputationInsight(t: string): boolean {
  return REP_PREFIXES.some((p) => t.startsWith(p))
}

function selectInput(d: Dossier) {
  return {
    reputationSignals: d.ruleOutputs.filter((i) => isReputationInsight(i.insight_type)),
    ownReviews: d.location.reviews ?? null,
    competitorReviews: d.competitors.map((c) => ({ name: c.name, reviews: c.reviews ?? null })),
  }
}

/** Deterministic, grounded, number-free fallback. */
function fallback(d: Dossier): EnrichedRecommendation[] {
  const signals = d.ruleOutputs.filter((i) => isReputationInsight(i.insight_type)).slice(0, 2)
  return signals.map((ins) => ({
    title: "Act on what your reviews are telling you",
    rationale: `Grounded in ${ins.title}. Address the theme, then reflect it back to guests.`,
    skillId: "reputation",
    ownerRole: "owner" as const,
    kind: "reputation" as const,
    recipe: [
      {
        channel: "Google / review replies + the floor",
        platforms: [],
        audience: "recent reviewers and the guests they influence",
        window: { note: "this week" },
        copy: "Thank you for the honest note. Here is what we are doing about it.",
        dependencies: ["owner or manager time to reply"],
      },
    ],
    confidence: "medium" as const,
    leverage: { label: "medium" as const, basisInternal: "reputation lift sized ordinally; cheapest revenue lever" },
    evidenceRefs: [ins.insight_type],
    knowledgeVersion: "reputation@v1",
  }))
}

export const reputationSkill: ProducerSkill = {
  id: "reputation",
  displayName: "Reputation & Reviews expert",
  ownerRole: "owner",
  kind: "reputation",
  tier: "reasoning",
  temperature: 0.4,
  knowledgeVersion: "reputation@v1",
  knowledge: REPUTATION_KNOWLEDGE,
  buildPrompt: (d) => buildSkillPrompt(reputationSkill, d, selectInput(d)),
  parse: (raw) =>
    coerceEnrichedPlays(raw, { skillId: "reputation", knowledgeVersion: "reputation@v1", defaultKind: "reputation", defaultOwner: "owner" }),
  fallback,
}
