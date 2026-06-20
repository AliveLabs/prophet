// ---------------------------------------------------------------------------
// Convergence skill (P5) — the ONE producer that sees the WHOLE dossier (no domain
// filter) and is tasked only with cross-domain patterns no single-domain skill can find.
// Runs on the DEEP pass (Opus + adaptive thinking) via `deep: true`. The marquee
// "smarter than the owner" fix from the 2026-06-19 deep review.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { domainLabel, distinctDomains } from "@/lib/skills/evidence-format"
import { CONVERGENCE_KNOWLEDGE } from "@/lib/skills/convergence/knowledge"

const SIGNAL_CAP = 40

/** Round-robin signals across their domains so the token cap can't starve a whole domain.
 *  A flat `.slice(0, cap)` would drop every late-ordered domain (e.g. all reviews), which is
 *  exactly the material convergence needs. This takes one signal from each domain per pass
 *  until the cap is hit, so every domain is represented before any domain gets seconds. */
export function interleaveByDomain<T extends { insight_type: string }>(items: T[], cap: number): T[] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const dom = domainLabel(it.insight_type)
    const g = groups.get(dom)
    if (g) g.push(it)
    else groups.set(dom, [it])
  }
  const lists = [...groups.values()]
  const out: T[] = []
  for (let round = 0; out.length < cap; round++) {
    let added = false
    for (const list of lists) {
      if (round < list.length) {
        out.push(list[round])
        added = true
        if (out.length >= cap) break
      }
    }
    if (!added) break // every list exhausted
  }
  return out
}

// UNLIKE the domain skills, selectInput does NOT prefix-filter — convergence must see ALL
// domains at once. Bounded for token discipline; the model gets the whole grounded layer,
// interleaved by domain so the cap never silently drops a domain (P5 review finding C).
function selectInput(d: Dossier) {
  return {
    allSignals: interleaveByDomain(d.ruleOutputs, SIGNAL_CAP).map((i) => ({
      insight_type: i.insight_type,
      title: i.title,
      summary: i.summary,
    })),
    events: d.demandCalendar.events.slice(0, 6),
    weather: d.demandCalendar.weather.slice(0, 4),
    reviewThemes: d.location.reviews?.themes ?? null,
    ownBusyTimes: d.location.busyTimes ?? null,
    profileAttributes: d.profile.attributes,
  }
}

/** Deterministic, grounded, NUMBER-FREE fallback. Emits a convergence play ONLY when >=3
 *  DISTINCT signal domains are present (else nothing — convergence needs real cross-domain
 *  material). Cites one signal from each of three different domains. */
function fallback(d: Dossier): EnrichedRecommendation[] {
  const byDomain = new Map<string, { insight_type: string; title: string }>()
  for (const ins of d.ruleOutputs) {
    const dom = domainLabel(ins.insight_type)
    if (!byDomain.has(dom)) byDomain.set(dom, { insight_type: ins.insight_type, title: ins.title })
  }
  const picks = [...byDomain.values()].slice(0, 3)
  if (picks.length < 3) return [] // not enough cross-domain material for a real convergence play

  return [
    {
      title: "Line up the threads that move together this week",
      rationale: `Grounded in ${picks.map((p) => p.title).join("; ")}. These point the same direction across different parts of your business — act on them as one move, not three.`,
      skillId: "convergence",
      ownerRole: "owner",
      kind: "capitalize",
      recipe: [
        {
          channel: "your floor + the channel that fits the moment",
          platforms: [],
          audience: "the customers all three signals point to",
          window: { note: "this week, while the signals overlap" },
          dependencies: ["confirm the timing of each signal before you commit"],
        },
      ],
      confidence: "medium",
      leverage: { label: "medium", basisInternal: "synthesizes 3+ domains; sized ordinally, no fabricated figure" },
      evidenceRefs: picks.map((p) => p.insight_type),
      knowledgeVersion: "convergence@v1",
    },
  ]
}

export const convergenceSkill: ProducerSkill = {
  id: "convergence",
  displayName: "Cross-domain convergence strategist",
  ownerRole: "owner",
  kind: "capitalize",
  category: "convergence",
  tier: "reasoning",
  deep: true, // Opus + adaptive thinking
  temperature: 0.5, // ignored on the deep path (Opus rejects temperature); kept for the type
  knowledgeVersion: "convergence@v1",
  knowledge: CONVERGENCE_KNOWLEDGE,
  buildPrompt: (d) => buildSkillPrompt(convergenceSkill, d, selectInput(d)),
  parse: (raw) => {
    const plays = coerceEnrichedPlays(raw, {
      skillId: "convergence",
      knowledgeVersion: "convergence@v1",
      defaultKind: "capitalize",
      defaultOwner: "owner",
    })
    if (!plays) return null // unparseable -> let the deterministic fallback decide
    // The >=3-distinct-domains rule is in the prompt, but a model can ignore it and cite 3 refs
    // from ONE domain — which would then ship tagged "Cross-domain" dishonestly (P5 review finding
    // D). Enforce it at runtime: drop any play that isn't genuinely cross-domain. Emitting nothing
    // when the model found no real convergence is correct — better than a boilerplate play.
    return plays.filter((p) => distinctDomains(p.evidenceRefs).length >= 3)
  },
  fallback,
}
