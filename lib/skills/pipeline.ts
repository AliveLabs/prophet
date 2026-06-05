// ---------------------------------------------------------------------------
// runBrief — the real engine entry point.
// producers (parallel) -> brand-fit harm review (graduated) -> synthesis -> voice.
// One call the routes/workflow/tests use. Transport is injectable (mock in tests).
// ---------------------------------------------------------------------------

import type { Transport } from "@/lib/ai/provider"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"
import type { ProducerSkill, SkillResult } from "@/lib/skills/skill-types"
import { runProducerSkills } from "@/lib/skills/run"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { reviewPlays, applyHarmReview } from "@/lib/skills/safety-review"
import { synthesize } from "@/lib/skills/synthesis"
import { voicePass } from "@/lib/skills/voice"

export type RunBriefOptions = { transport?: Transport; skills?: ProducerSkill[]; maxPlays?: number }

export type BriefResult = {
  brief: Brief
  skillResults: SkillResult[]
  dropped: { play: EnrichedRecommendation; reason: string }[]
}

export async function runBrief(dossier: Dossier, opts: RunBriefOptions = {}): Promise<BriefResult> {
  const skills = opts.skills ?? PRODUCER_SKILLS
  const t = opts.transport ? { transport: opts.transport } : {}

  const skillResults = await runProducerSkills(skills, dossier, t)
  const candidates = skillResults.flatMap((r) => r.plays)

  // graduated brand-fit review, gated by the customer's tolerance slider (default 50)
  const verdicts = await reviewPlays(dossier, candidates, t)
  const { kept, dropped } = applyHarmReview(candidates, verdicts, dossier.profile.brandTolerance ?? 50)

  const synthInput: SkillResult[] = [{ skillId: "reviewed", status: "ok", plays: kept }]
  const brief = await voicePass(await synthesize(dossier, synthInput, { ...t, maxPlays: opts.maxPlays }))

  return { brief, skillResults, dropped }
}
