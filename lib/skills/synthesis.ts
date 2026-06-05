// ---------------------------------------------------------------------------
// Chief-of-Staff synthesis (Phase 1/3) — selects, ranks, and wraps the brief.
//
// Takes every producer skill's grounded plays and produces the day's Brief:
// a 3-8 word headline, a short deck, and the 1-3 plays that actually matter.
// Ruthlessly SUBTRACTIVE (no diversity quota); forward demand outranks standing
// rivalry. It SELECTS and ORDERS plays but never edits their recipes (grounding
// is preserved). Deterministic fallback guarantees a brief even on model failure.
// ---------------------------------------------------------------------------

import { generateStructured, type Transport } from "@/lib/ai/provider"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { SkillResult } from "@/lib/skills/skill-types"
import type { Brief, EnrichedRecommendation, Confidence, RecKind } from "@/lib/skills/types"

export type SynthOptions = { transport?: Transport; maxPlays?: number }

const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, directional: 1 }
// forward-demand kinds lead; standing competitive moves sit below.
const KIND_RANK: Record<RecKind, number> = { prepare: 5, capitalize: 5, reputation: 3, positioning: 2, ops: 4 }

function score(p: EnrichedRecommendation): number {
  return (KIND_RANK[p.kind] ?? 1) * 10 + (CONF_RANK[p.confidence] ?? 1)
}

function rankDeterministic(candidates: EnrichedRecommendation[], max: number): EnrichedRecommendation[] {
  return [...candidates].sort((a, b) => score(b) - score(a)).slice(0, max)
}

function quietBrief(d: Dossier): Brief {
  return {
    locationId: d.locationId,
    dateKey: d.dateKey,
    headline: "A quiet week. Hold your ground.",
    deck: "No urgent moves and nothing on the calendar or forecast worth flagging. We will surface the moment something moves.",
    plays: [],
    asOf: d.generatedAt,
  }
}

export async function synthesize(d: Dossier, results: SkillResult[], opts: SynthOptions = {}): Promise<Brief> {
  const max = opts.maxPlays ?? 3
  const candidates = results.flatMap((r) => r.plays)
  if (candidates.length === 0) return quietBrief(d)

  const system = [
    "You are the Chief of Staff assembling a restaurant's brief from candidate plays produced by expert skills.",
    "Be ruthlessly SUBTRACTIVE: pick the 1-3 that genuinely matter THIS week. A brief may be a single play.",
    "Forward demand (events/weather this week) outranks standing competitive rivalry. Do NOT force variety.",
    "Write a 3-8 word headline and a 140-250 character deck. Plain language, no em dashes, no chef jargon.",
    "Do NOT edit the plays. Only select and order them, and state any number ONLY if it appears in the plays.",
    'Return JSON: { "headline": string, "deck": string, "order": number[] (indices into the candidates array, best first) }.',
  ].join("\n")

  const prompt = JSON.stringify(
    { dateKey: d.dateKey, profile: { name: d.profile.name, attributes: d.profile.attributes }, candidates },
    null,
    2,
  )

  const selection = await generateStructured<{ headline: string; deck: string; order: number[] }>(
    { tier: "reasoning", system, prompt, temperature: 0.3 },
    {
      transport: opts.transport,
      validate: (raw) => {
        const r = raw as { headline?: unknown; deck?: unknown; order?: unknown }
        if (typeof r?.headline !== "string" || typeof r?.deck !== "string" || !Array.isArray(r?.order)) return null
        const order = (r.order as unknown[]).filter((n): n is number => typeof n === "number" && n >= 0 && n < candidates.length)
        if (order.length === 0) return null
        return { headline: r.headline, deck: r.deck, order }
      },
      fallback: () => {
        const ranked = rankDeterministic(candidates, max)
        return {
          headline: ranked[0]?.title ?? "Your brief",
          deck: `The ${ranked.length} move${ranked.length === 1 ? "" : "s"} that matter most this week, drawn from what changed nearby.`,
          order: ranked.map((p) => candidates.indexOf(p)),
        }
      },
    },
  )

  const ordered = selection.order.map((i) => candidates[i]).filter(Boolean).slice(0, max)
  const plays = ordered.length ? ordered : rankDeterministic(candidates, max)

  return {
    locationId: d.locationId,
    dateKey: d.dateKey,
    headline: selection.headline,
    deck: selection.deck,
    plays,
    asOf: d.generatedAt,
  }
}
