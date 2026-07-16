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

import { generateStructured, DEEP_MODEL, type Transport } from "@/lib/ai/provider"
import { skillInputHash } from "@/lib/skills/input-hash"
import { buildRefIndex, type Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill, SkillResult } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import {
  loadActiveKnowledge,
  effectiveKnowledgeVersion,
  type KnowledgeInjection,
} from "@/lib/skills/knowledge-feeds"

export type RunOptions = {
  transport?: Transport
  /** Test/ops seam: inject a pre-resolved knowledge set instead of reading skill_knowledge. */
  knowledge?: KnowledgeInjection
  /** Org id for org-scoped learnings (the dossier only carries locationId). */
  organizationId?: string | null
  /** Differential builds: yesterday's reusable per-skill state (see extractPreviousBuild). When a
   *  skill's FRESH inputHash matches its previous hash, its model call is skipped and the previous
   *  real plays carry forward. Absent (full-build day / env off / no usable history) → all run. */
  previous?: import("@/lib/skills/differential").PreviousBuild
}

export async function runProducerSkill(
  skill: ProducerSkill,
  dossier: Dossier,
  opts: RunOptions = {},
): Promise<SkillResult> {
  try {
    // P14: ACTIVE learned priors for this skill (fail-soft → EMPTY when the table is absent/empty, so
    // the prompt is byte-identical to today). Skipped entirely when a skill has no learning hook.
    const knowledge: KnowledgeInjection =
      opts.knowledge ??
      (skill.learning
        ? await loadActiveKnowledge(
            skill.id,
            {
              locationId: dossier.profile.locationId,
              organizationId: opts.organizationId ?? null,
            },
            // §2.5/§2.3 defense in depth: only the kinds this skill DECLARED it accepts are injected.
            { acceptedKinds: skill.learning.acceptedLearningKinds },
          )
        : { global: [], scoped: [], globalVersion: "" })
    // Plays stamp the EFFECTIVE version (base + global-set hash); empty set → base unchanged.
    const knowledgeVersion = effectiveKnowledgeVersion(skill.knowledgeVersion, knowledge)
    // Differential builds (Phase 0): hash the skill's input slice + knowledge. Recorded on the
    // result → skillHealth; Phase 1 compares against yesterday's to skip unchanged experts.
    // Option (b) (2026-07-16): when a skill declares selectStableInput, hash THAT instead — the
    // stable core minus daily-churn context (LLM-regenerated prose, engagement tick-ups). The
    // volatile fields still reach the prompt; they just stop forcing a rebuild. NOTE: changing the
    // hash basis means the first build after deploy matches nothing (full build), reuse resumes
    // day 2. Fail-soft: a hashing error must never break a build (hash stays undefined → re-runs).
    let inputHash: string | undefined
    const hashSource = skill.selectStableInput ?? skill.selectInput
    if (hashSource) {
      try {
        inputHash = skillInputHash(skill.id, hashSource(dossier), knowledgeVersion)
      } catch (err) {
        console.warn(`[runProducerSkill] ${skill.id} input-hash failed (differential reuse disabled for this run):`, err)
      }
    }
    // Phase 1 REUSE: identical slice + knowledge since the last real run → the expert would see
    // byte-identical evidence → skip the model call and carry the previous grounded plays forward.
    // Deliberately NO elapsedMs on reused results (a 0 would dilute the p95 latency signal).
    if (inputHash && opts.previous && opts.previous.hashes[skill.id] === inputHash) {
      console.log(`[runProducerSkill] ${skill.id}: input unchanged — reusing previous plays (differential)`)
      return { skillId: skill.id, status: "ok", plays: opts.previous.outputs[skill.id] ?? [], inputHash, reused: true }
    }

    const { systemCached, system, prompt } = skill.buildPrompt(dossier, knowledge)
    // Deep skills (convergence) → Opus + adaptive thinking, high effort. Producers → the base
    // reasoning model (Sonnet 4.6) + adaptive thinking, MEDIUM effort (quality uplift, Bryan
    // 2026-06-20). max_tokens = 32k: adaptive-thinking tokens count toward the output budget, so on
    // a REAL (large) dossier prompt the thinking alone exhausted the old 16k ceiling BEFORE the JSON
    // was emitted → truncated → every producer silently served its deterministic FALLBACK for ~2
    // weeks (2026-06-20 → 07-03; the root of the "samey / not insightful" complaint). 32k matches
    // the deep pass's headroom. The provider omits temperature on any thinking path. COST DIAL-DOWN:
    // if spend threatens the model, drop producers back to no-thinking + temperature (remove
    // thinking/effort here) — that's the "like-for-like" 4.6 baseline.
    const reqTuning = skill.deep
      ? { model: DEEP_MODEL, thinking: true as const, effort: "high" as const }
      : { thinking: true as const, effort: skill.effort ?? ("medium" as const), maxOutputTokens: 32000 }

    // OBSERVABILITY (2026-07-03): a producer that serves its deterministic fallback used to be
    // INDISTINGUISHABLE from a real generation (both come back status "ok"). Capture it so the brief
    // records per-skill health and the pipeline watchdog can alert on fleet-wide fallback-serving.
    // Object holder (not a bare `let`): a bare let assigned only inside the onFallback closure gets
    // narrowed back to its `null` initializer by TS control-flow; a property read keeps its declared type.
    const degrade: { reason: string | null } = { reason: null }
    // Per-skill token attribution (2026-07-16): the provider reports usage per 200 response via
    // onUsage. Accumulate (a retried call can in principle report more than once). Same object-holder
    // pattern as `degrade` — see that comment for the TS narrowing rationale.
    const usage: { tokens: SkillResult["tokens"] | null } = { tokens: null }
    // Wall-clock the model call (p95 watch signal): a producer drifting toward the abort ceiling is
    // the precursor to timeout-fallbacks, so the brief records elapsed per skill and pipeline-health
    // watches the fleet p95. Includes governor slot-wait — that's intentional; the operator-visible
    // question is "how close is this skill to degrading", whatever the cause.
    const startedAt = Date.now()
    const plays = await generateStructured<EnrichedRecommendation[]>(
      {
        tier: skill.tier,
        label: skill.id,
        systemCached,
        system,
        prompt,
        temperature: skill.temperature,
        onUsage: (u) => {
          const t = (usage.tokens ??= { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 })
          t.inputTokens += u.inputTokens
          t.outputTokens += u.outputTokens
          t.cacheWriteTokens += u.cacheWriteTokens
          t.cacheReadTokens += u.cacheReadTokens
        },
        ...reqTuning,
      },
      {
        transport: opts.transport,
        validate: (raw) => skill.parse(raw, dossier),
        fallback: () => skill.fallback(dossier),
        onFallback: (info) => { degrade.reason = info.reason },
      },
    )
    const elapsedMs = Date.now() - startedAt

    const index = buildRefIndex(dossier)
    const grounded = plays
      .map((p) => ({ ...p, skillId: skill.id, knowledgeVersion }))
      .filter(
        (p) =>
          Array.isArray(p.evidenceRefs) &&
          p.evidenceRefs.length > 0 &&
          p.evidenceRefs.every((r) => index.allowedRefs.has(r)),
      )

    return {
      skillId: skill.id,
      status: "ok",
      plays: grounded,
      elapsedMs,
      ...(inputHash ? { inputHash } : {}),
      ...(degrade.reason ? { usedFallback: true, fallbackReason: degrade.reason } : {}),
      ...(usage.tokens ? { tokens: usage.tokens } : {}),
    }
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
