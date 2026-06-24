// ---------------------------------------------------------------------------
// Marketing / Campaign skill — ongoing social/content campaigns grounded in social rules.
// (Event/weather-triggered demand is the Local-Demand skill's job.)
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { selectAdjacentSignals } from "@/lib/skills/domain-map"
import { MARKETING_KNOWLEDGE } from "@/lib/skills/marketing/knowledge"

function isSocialInsight(t: string): boolean {
  return t.startsWith("social.")
}

function selectInput(d: Dossier) {
  // P5 adjacency: what's happening locally (demand) + how guests talk (reputation) sharpen
  // a campaign's angle. Omitted when none → byte-identical to the pre-P5 prompt.
  const adjacentSignals = selectAdjacentSignals(d, "marketing")
  return {
    socialSignals: d.ruleOutputs.filter((i) => isSocialInsight(i.insight_type)),
    ownSocial: d.location.social ?? null,
    ownVisual: d.location.visual ?? null,
    competitorSocial: d.competitors.map((c) => ({ name: c.name, social: c.social ?? null, visual: c.visual ?? null })),
    // Far-away MAJOR events (metro attention moments, e.g. a playoff game across town).
    // TIE-IN material only — see the metro-hook rules in the playbook + EVENT_GEOGRAPHY.
    metroAttentionHooks: (d.demandCalendar.metroHooks ?? []).slice(0, 3).map((e) => ({
      title: e.title,
      when: e.startDatetime,
      venue: e.venue?.name,
      distanceMiles: e.distanceMiles,
      magnitude: e.magnitude,
      role: e.role,
    })),
    ...(adjacentSignals.length ? { adjacentSignals } : {}),
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
        platforms: d.tier.ownSocialPlatforms,
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
  category: "marketing",
  tier: "reasoning",
  temperature: 0.6,
  knowledgeVersion: "marketing@v1",
  knowledge: MARKETING_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(marketingSkill, d, selectInput(d), k),
  parse: (raw) =>
    coerceEnrichedPlays(raw, { skillId: "marketing", knowledgeVersion: "marketing@v1", defaultKind: "capitalize", defaultOwner: "marketing" }),
  fallback,
  // P14 learning hook: marketing consumes industry/menu-trend sources (NRN, MRM, NRA What's Hot →
  // external_trend), click feedback, and ask routing. Opt-in metadata; injection still ACTIVE-gated.
  learning: {
    streams: ["external", "click", "ask"],
    playTypeLeadDomain: "marketing",
    acceptedLearningKinds: ["external_trend", "editorial"],
  },
}
