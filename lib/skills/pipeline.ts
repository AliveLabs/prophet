// ---------------------------------------------------------------------------
// runBrief — the real engine entry point.
// producers (parallel) -> brand-fit harm review (graduated) -> synthesis -> voice.
// One call the routes/workflow/tests use. Transport is injectable (mock in tests).
// ---------------------------------------------------------------------------

import type { Transport } from "@/lib/ai/provider"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"
import type { ProducerSkill, SkillResult } from "@/lib/skills/skill-types"
import type { PlayTypeMultiplierLookup } from "@/lib/skills/feedback-rollup"
// (suppressedKeys / evergreen / playTypeMultipliers are loaded by the build caller from
//  lib/insights/evergreen.ts and lib/skills/feedback-rollup.ts)
import { runProducerSkills } from "@/lib/skills/run"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { reviewPlays, applyHarmReview } from "@/lib/skills/safety-review"
import { synthesize } from "@/lib/skills/synthesis"
import { synthesisWrite } from "@/lib/skills/synthesis-write"
import { presentBrief } from "@/lib/skills/presenter"
import { voicePass } from "@/lib/skills/voice"

export type RunBriefOptions = {
  transport?: Transport
  skills?: ProducerSkill[]
  maxPlays?: number
  /** P7a: playKeys in cross-day dismissal cooldown (loaded by the build caller from evergreen_dismissals). */
  suppressedKeys?: Set<string>
  /** P7b: persisted "saved" plays to consider resurfacing (loaded by the build caller from evergreen_plays). */
  evergreen?: EnrichedRecommendation[]
  /** P15: distilled click-feedback multiplier lookup (skill_feedback_rollup), loaded by the build
   *  caller for this location's scope. Absent → NEUTRAL_LOOKUP (every play × 1.0) ⇒ no rank change. */
  playTypeMultipliers?: PlayTypeMultiplierLookup
  /** P17a SHADOW MODE: a multiplier lookup built from SHADOW-status rows. NEVER serves — it is only
   *  replayed + logged (would it have reordered the brief?). Absent → no shadow replay. */
  shadowMultipliers?: PlayTypeMultiplierLookup
  /** How many shadow multipliers were in play (0 → the shadow replay is skipped). */
  shadowSignalCount?: number
}

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

  // synthesis SELECT+ORDER -> P11.B WRITE step (tighten fused/multi-signal plays) ->
  // P11.A presenter (real evidence + relational framing + strip internal numerics) -> voice.
  // Each P11 step is fail-soft (keep-original / un-presented), so a model hiccup degrades to
  // the grounded floor rather than breaking the brief.
  const synthesized = await synthesize(dossier, synthInput, {
    ...t,
    maxPlays: opts.maxPlays,
    suppressedKeys: opts.suppressedKeys,
    evergreen: opts.evergreen,
    playTypeMultipliers: opts.playTypeMultipliers,
    shadowMultipliers: opts.shadowMultipliers,
    shadowSignalCount: opts.shadowSignalCount,
  })
  const written: Brief = {
    ...synthesized,
    plays: await synthesisWrite(synthesized.plays, dossier, opts.transport),
  }
  const presented = presentBrief(written, dossier)
  const brief = await voicePass(presented)

  return { brief, skillResults, dropped }
}
