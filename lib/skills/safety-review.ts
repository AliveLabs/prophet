// ---------------------------------------------------------------------------
// Brand-fit / tone-deaf reviewer (graduated). Bryan's model: don't fail the whole
// brief on a flagged play — SCORE each play's tone-deaf severity and let the engine
// act on a gradient:
//   3 severe   -> DROP the play
//   2 moderate -> keep, force confidence to "directional" (ranks last)
//   1 mild     -> keep, nudge a "high" play down to "medium"
//   0 none     -> unchanged
// Runs after producers, before synthesis. Model-backed (reasoning tier) with a
// deterministic no-flag fallback so a model failure never blocks the brief.
// ---------------------------------------------------------------------------

import { generateStructured, type Transport } from "@/lib/ai/provider"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { EnrichedRecommendation, Confidence } from "@/lib/skills/types"

export type Severity = 0 | 1 | 2 | 3
export type HarmVerdict = { index: number; severity: Severity; reason: string }

function buildPrompt(d: Dossier, plays: EnrichedRecommendation[]): { system: string; prompt: string } {
  const system = [
    `You are a brand-fit reviewer for ${d.profile.name}, a ${d.profile.attributes.priceTier ?? ""} ${d.profile.attributes.cuisine ?? "restaurant"}.`,
    "Score each recommendation for how TONE-DEAF or OFF-BRAND it is for THIS restaurant, on a 0-3 scale:",
    "0 = on-brand and sound. 1 = mildly off (small wording/positioning risk). 2 = moderately off (would feel wrong to a careful owner). 3 = severe (cheapens the brand, contradicts the positioning, or is risky/embarrassing).",
    "Example of SEVERE for a premium steakhouse: launching a cheap value plate to chase a budget competitor (it cheapens the premium brand).",
    'Return ONLY a JSON array, one object per play, in order: [{ "index": number, "severity": 0|1|2|3, "reason": string }].',
  ].join("\n")
  const prompt = JSON.stringify(
    plays.map((p, i) => ({ index: i, title: p.title, rationale: p.rationale, kind: p.kind })),
    null,
    2,
  )
  return { system, prompt }
}

export async function reviewPlays(
  d: Dossier,
  plays: EnrichedRecommendation[],
  opts: { transport?: Transport } = {},
): Promise<HarmVerdict[]> {
  if (plays.length === 0) return []
  const { system, prompt } = buildPrompt(d, plays)
  return generateStructured<HarmVerdict[]>(
    { tier: "reasoning", system, prompt, temperature: 0.1 },
    {
      transport: opts.transport,
      validate: (raw) => {
        if (!Array.isArray(raw)) return null
        return raw.map((r) => {
          const o = (r ?? {}) as Record<string, unknown>
          const sev = Number(o.severity)
          return {
            index: typeof o.index === "number" ? o.index : -1,
            severity: ([0, 1, 2, 3].includes(sev) ? sev : 0) as Severity,
            reason: typeof o.reason === "string" ? o.reason : "",
          }
        })
      },
      fallback: () => plays.map((_, i) => ({ index: i, severity: 0 as Severity, reason: "" })),
    },
  )
}

const DOWN_ONE: Record<Confidence, Confidence> = { high: "medium", medium: "directional", directional: "directional" }

export type HarmApplication = {
  kept: EnrichedRecommendation[]
  dropped: { play: EnrichedRecommendation; reason: string }[]
}

/**
 * The customer's tolerance (0-100) sets the DROP line; severity is the judge's
 * objective call. Tame -> drop moderate+; balanced -> drop severe only; adventurous
 * -> never drop, but show risky ideas at low confidence. Default 50 = balanced
 * (preserves prior behavior). This is the control system: one slider per customer,
 * not a per-skill recalibration.
 */
export function dropThreshold(tolerance: number): number {
  if (tolerance <= 33) return 2 // tame: drop moderate (2) and severe (3)
  if (tolerance >= 67) return 4 // adventurous: nothing is dropped (no severity reaches 4)
  return 3 // balanced: drop severe (3) only
}

/** Apply the graduated, tolerance-aware model. */
export function applyHarmReview(
  plays: EnrichedRecommendation[],
  verdicts: HarmVerdict[],
  tolerance = 50,
): HarmApplication {
  const threshold = dropThreshold(tolerance)
  const byIndex = new Map(verdicts.map((v) => [v.index, v]))
  const kept: EnrichedRecommendation[] = []
  const dropped: { play: EnrichedRecommendation; reason: string }[] = []
  plays.forEach((p, i) => {
    const v = byIndex.get(i)
    const sev = v?.severity ?? 0
    if (sev >= threshold) {
      dropped.push({ play: p, reason: v?.reason ?? "off-brand for this tolerance" })
      return
    }
    // kept: a risky-but-kept play (e.g. severe kept under high tolerance) shows at low confidence
    if (sev >= 2) kept.push({ ...p, confidence: "directional" })
    else if (sev === 1) kept.push({ ...p, confidence: DOWN_ONE[p.confidence] })
    else kept.push(p)
  })
  return { kept, dropped }
}
