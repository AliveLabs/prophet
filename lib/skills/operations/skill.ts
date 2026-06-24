// ---------------------------------------------------------------------------
// Operations skill — staffing/hours/throughput from traffic patterns.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { selectAdjacentSignals } from "@/lib/skills/domain-map"
import { OPERATIONS_KNOWLEDGE } from "@/lib/skills/operations/knowledge"

const OPS_PREFIXES = ["traffic.", "hours"]

function isOpsInsight(t: string): boolean {
  return OPS_PREFIXES.some((p) => t.startsWith(p))
}

function selectInput(d: Dossier) {
  // P5 adjacency: a small, capped peek at adjacent-domain signals (demand) so staffing
  // can react to the demand spike driving the traffic. Omitted entirely when none, so the
  // prompt is byte-identical to pre-P5 for locations with no adjacent signal.
  const adjacentSignals = selectAdjacentSignals(d, "operations")
  return {
    trafficSignals: d.ruleOutputs.filter((i) => isOpsInsight(i.insight_type)),
    ownBusyTimes: d.location.busyTimes ?? null,
    competitorBusyTimes: d.competitors.map((c) => ({ name: c.name, busyTimes: c.busyTimes ?? null })),
    ...(adjacentSignals.length ? { adjacentSignals } : {}),
  }
}

/** Deterministic, grounded, number-free fallback. */
function fallback(d: Dossier): EnrichedRecommendation[] {
  const signals = d.ruleOutputs.filter((i) => isOpsInsight(i.insight_type)).slice(0, 2)
  return signals.map((ins) => ({
    title: "Staff to the demand this pattern shows",
    rationale: `Grounded in ${ins.title}. Match labor and prep to the real curve, not a flat schedule.`,
    skillId: "operations",
    ownerRole: "gm" as const,
    kind: "ops" as const,
    recipe: [
      {
        channel: "scheduling / prep",
        platforms: [],
        audience: "your team for the affected shift",
        window: { note: "the window in the signal" },
        creativeDirection: undefined,
        dependencies: ["staff availability"],
      },
    ],
    confidence: "medium" as const,
    leverage: { label: "medium" as const, basisInternal: "labor matched to demand curve; sized ordinally" },
    evidenceRefs: [ins.insight_type],
    knowledgeVersion: "operations@v1",
  }))
}

export const operationsSkill: ProducerSkill = {
  id: "operations",
  displayName: "Operations expert (staffing, hours, throughput)",
  ownerRole: "gm",
  kind: "ops",
  category: "operations",
  tier: "reasoning",
  temperature: 0.4,
  knowledgeVersion: "operations@v1",
  knowledge: OPERATIONS_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(operationsSkill, d, selectInput(d), k),
  parse: (raw) =>
    coerceEnrichedPlays(raw, { skillId: "operations", knowledgeVersion: "operations@v1", defaultKind: "ops", defaultOwner: "gm" }),
  fallback,
}
