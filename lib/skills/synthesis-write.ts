// ---------------------------------------------------------------------------
// Synthesis WRITE step (P11.B) — the bounded rewrite for FUSED / multi-ref plays.
//
// Today synthesis is SELECT + ORDER only ("Do NOT edit the plays"), so a fused
// multi-signal play can read as stapled fragments ("Feature the short rib. Also
// the World Cup is nearby."). This step runs ONLY on plays that fuse ≥2 distinct
// evidence signals (or are marked a fusion via stableKey), and rewrites the
// title + rationale to:
//   - name the THROUGH-LINE connecting the signals,
//   - lead with the strongest signal,
//   - narrow to ONE signal if they don't actually connect.
//
// Single-signal plays are UNTOUCHED (their producer copy stays grounded). Every
// safeguard from fusion.ts applies: the rewrite may state ONLY numbers present in
// the input play; any fabricated number → deterministic keep-original fallback.
// Model failure → keep-original. This NEVER drops or reorders a play.
// ---------------------------------------------------------------------------

import { generateStructured, DEEP_MODEL, type Transport } from "@/lib/ai/provider"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { dedupeRefs } from "@/lib/skills/evidence-format"
import { extractNumbers } from "@/lib/eval/checks"

/** A play is a WRITE candidate when it fuses ≥2 distinct evidence signals (or is a marked fusion). */
export function isMultiSignal(p: EnrichedRecommendation): boolean {
  if (p.stableKey?.startsWith("fused:")) return true
  return dedupeRefs(p.evidenceRefs ?? []).length >= 2
}

/** All narrative text of a play (for the anti-fabrication numeric guard). */
function playText(p: EnrichedRecommendation): string {
  const steps = (p.recipe ?? []).flatMap((s) => [s.channel, s.audience, s.window?.note, s.offer, s.copy, s.creativeDirection])
  return [p.title, p.rationale, ...steps].filter(Boolean).join(" ")
}

const WRITE_SYSTEM = [
  "You are an editor tightening ONE restaurant action play that fuses multiple signals into a single",
  "coherent recommendation. The play's title + rationale currently read as stapled fragments. Rewrite",
  "ONLY the title and rationale so they:",
  "  - name the THROUGH-LINE that connects the signals (why these belong in one move),",
  "  - LEAD with the strongest signal,",
  "  - if the signals do NOT actually connect, narrow to the single strongest one and drop the rest.",
  "",
  "Do NOT touch the recipe, evidence, confidence, or leverage. Keep it plain (Ticket's voice): no em",
  "dashes, no chef jargon. NEVER invent a number, name, date, or place — state ONLY facts already in",
  "the input play. Keep the title under ~10 words and the rationale to 1-2 sentences.",
  "",
  'Return JSON: { "title": string, "rationale": string }.',
].join("\n")

/** Rewrite one multi-signal play's title + rationale. Deterministic keep-original on any failure. */
async function writeOne(
  play: EnrichedRecommendation,
  d: Dossier,
  transport?: Transport,
): Promise<EnrichedRecommendation> {
  const inputNums = new Set(extractNumbers(playText(play)))
  const prompt = JSON.stringify(
    {
      restaurant: { name: d.profile.name, attributes: d.profile.attributes, voiceTone: d.profile.voiceTone },
      play: { title: play.title, rationale: play.rationale, recipe: play.recipe, evidenceRefs: play.evidenceRefs },
    },
    null,
    2,
  )

  const rewritten = await generateStructured<{ title: string; rationale: string } | null>(
    { tier: "reasoning", system: WRITE_SYSTEM, prompt, model: DEEP_MODEL, thinking: true, effort: "medium", maxOutputTokens: 2000 },
    {
      transport,
      validate: (raw) => {
        const r = (raw ?? {}) as { title?: unknown; rationale?: unknown }
        if (typeof r.title !== "string" || typeof r.rationale !== "string") return null
        if (!r.title.trim() || !r.rationale.trim()) return null
        // Anti-fabrication: the rewrite is a net-new model write; reject any number it states that
        // wasn't in the input play → deterministic keep-original (same guard as fusion.ts).
        const newNums = extractNumbers(`${r.title} ${r.rationale}`)
        if (newNums.some((n) => !inputNums.has(n))) return null
        return { title: r.title, rationale: r.rationale }
      },
      fallback: () => null, // keep original copy
    },
  )

  return rewritten ? { ...play, title: rewritten.title, rationale: rewritten.rationale } : play
}

/**
 * Run the WRITE step over a brief's plays. Single-signal plays pass through untouched (grounding
 * preserved); each multi-signal play is rewritten in parallel with a deterministic keep-original
 * fallback. Order and count are never changed. Usually a near-no-op (most briefs have ≤1 fused play).
 */
export async function synthesisWrite(
  plays: EnrichedRecommendation[],
  d: Dossier,
  transport?: Transport,
): Promise<EnrichedRecommendation[]> {
  const candidates = plays.filter(isMultiSignal)
  if (candidates.length === 0) return plays // fast path: nothing to rewrite, no model call

  const rewrites = new Map<EnrichedRecommendation, EnrichedRecommendation>()
  await Promise.all(
    candidates.map(async (p) => {
      rewrites.set(p, await writeOne(p, d, transport))
    }),
  )
  return plays.map((p) => rewrites.get(p) ?? p)
}
