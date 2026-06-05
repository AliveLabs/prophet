// ---------------------------------------------------------------------------
// runProducerSkill — execute one expert skill over the dossier (Phase 3).
//
// - calls generateStructured (reasoning tier) with the skill's prompt
// - validates/parses to plays, falling back to the skill's deterministic plays
// - STAMPS skillId + knowledgeVersion
// - GROUND-FILTERS: drops any play whose evidenceRefs don't resolve to the
//   dossier's allowed refs (runtime anti-fabrication, defense-in-depth with the
//   eval checks). A skill can only recommend what the 76 rules proved.
// - isolates failure: a throw becomes { status: "failed", plays: [] } so one
//   skill never aborts the brief (the fan-out uses Promise.all of these).
// ---------------------------------------------------------------------------

import { generateStructured, type Transport } from "@/lib/ai/provider"
import { buildRefIndex, type Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill, SkillResult } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"

export type RunOptions = { transport?: Transport }

export async function runProducerSkill(
  skill: ProducerSkill,
  dossier: Dossier,
  opts: RunOptions = {},
): Promise<SkillResult> {
  try {
    const { system, prompt } = skill.buildPrompt(dossier)
    const plays = await generateStructured<EnrichedRecommendation[]>(
      { tier: skill.tier, system, prompt, temperature: skill.temperature },
      {
        transport: opts.transport,
        validate: (raw) => skill.parse(raw, dossier),
        fallback: () => skill.fallback(dossier),
      },
    )

    const index = buildRefIndex(dossier)
    const grounded = plays
      .map((p) => ({ ...p, skillId: skill.id, knowledgeVersion: skill.knowledgeVersion }))
      .filter(
        (p) =>
          Array.isArray(p.evidenceRefs) &&
          p.evidenceRefs.length > 0 &&
          p.evidenceRefs.every((r) => index.allowedRefs.has(r)),
      )

    return { skillId: skill.id, status: "ok", plays: grounded }
  } catch (err) {
    return { skillId: skill.id, status: "failed", plays: [], error: err instanceof Error ? err.message : "failed" }
  }
}

/** Fan out all producer skills over one dossier (parallel, failure-isolated). */
export async function runProducerSkills(
  skills: ProducerSkill[],
  dossier: Dossier,
  opts: RunOptions = {},
): Promise<SkillResult[]> {
  return Promise.all(skills.map((s) => runProducerSkill(s, dossier, opts)))
}
