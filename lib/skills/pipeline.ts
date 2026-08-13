// ---------------------------------------------------------------------------
// runBrief — the real engine entry point.
// producers (parallel) -> brand-fit harm review (graduated) -> synthesis -> voice.
// One call the routes/workflow/tests use. Transport is injectable (mock in tests).
//
// Differential builds Phase 2: when EVERY producer was reused AND the downstream-input
// fingerprint matches the previous brief's, the whole downstream stage (harm review,
// synthesis, write) is carried forward instead of regenerated — see the reuse branch below.
// ---------------------------------------------------------------------------

import type { Transport } from "@/lib/ai/provider"
import { anthropicCallStats } from "@/lib/ai/provider"
import { deltaTokensByModel, estimateAnthropicCostUsd, type ModelTokenTotals } from "@/lib/ai/pricing"
import { PER_BRIEF_CEILING_USD, currentSpendBudget, runWithSpendBudget } from "@/lib/ai/spend-budget"
import { logEvalRecord, recordBriefEval } from "@/lib/eval/record"
import { briefGroundTruth } from "@/lib/eval/ground-truth"
import { buildRefIndex, type Dossier } from "@/lib/insights/dossier/types"
import type { Brief, EnrichedRecommendation, SkillHealth } from "@/lib/skills/types"
import type { ProducerSkill, SkillResult } from "@/lib/skills/skill-types"
import { NEUTRAL_LOOKUP, type PlayTypeMultiplierLookup } from "@/lib/skills/feedback-rollup"
import {
  decideDownstreamReuse,
  downstreamFingerprint,
  type DownstreamFingerprintInputs,
  type PreviousBuild,
} from "@/lib/skills/differential"
import { computePlayTypeKey, playKey } from "@/lib/skills/preferences"
// (suppressedKeys / evergreen / playTypeMultipliers are loaded by the build caller from
//  lib/insights/evergreen.ts and lib/skills/feedback-rollup.ts)
import { runProducerSkills } from "@/lib/skills/run"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { selectFirstBriefProducers, type ProducerSkipped } from "@/lib/skills/first-brief-producers"
import { reviewPlays, applyHarmReview } from "@/lib/skills/safety-review"
import { synthesize, buildCoverage, LEAD_DOMAIN_BY_SKILL } from "@/lib/skills/synthesis"
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
  /** Differential builds: yesterday's reusable per-skill state (extractPreviousBuild). Callers omit
   *  it on full-build days (Sunday local), when DIFFERENTIAL_BUILDS=0, or on ?fullBuild=1. */
  previous?: PreviousBuild
  /** Beta rescue 3.1: this is the location's FIRST brief, so producers whose grounding evidence has
   *  not landed yet are skipped instead of called (lib/skills/first-brief-producers.ts — a skipped
   *  producer provably could not have contributed a play, so the brief's content is unchanged).
   *  DEFAULT FALSE, and the nightly path never sets it: a location with any prior brief runs the
   *  full registry exactly as it does today. Ignored when `skills` is supplied explicitly (a caller
   *  naming its own set has already decided). */
  firstBrief?: boolean
}

export type BriefResult = {
  brief: Brief
  skillResults: SkillResult[]
  dropped: { play: EnrichedRecommendation; reason: string }[]
}

export async function runBrief(dossier: Dossier, opts: RunBriefOptions = {}): Promise<BriefResult> {
  // Snapshot provider counters BEFORE anything else: this build's spend (and its telemetry) is the
  // DELTA from here, and the per-brief ceiling needs the same baseline. Inert under a mock transport.
  const providerAtStart = anthropicCallStats()
  // Per-brief spend ceiling (step 2). Build-scoped via AsyncLocalStorage so co-located builds on one
  // Fluid instance cannot degrade each other. A null ceiling (the default) opens no context at all.
  return runWithSpendBudget(PER_BRIEF_CEILING_USD, providerAtStart.tokensByModel, () =>
    runBriefBudgeted(dossier, opts, providerAtStart),
  )
}

async function runBriefBudgeted(
  dossier: Dossier,
  opts: RunBriefOptions,
  providerAtStart: { requests: number; rateLimited: number; tokensByModel: Record<string, ModelTokenTotals> },
): Promise<BriefResult> {
  const t = opts.transport ? { transport: opts.transport } : {}

  // FIRST BRIEF ONLY: drop the producers that could not have produced anything from this dossier.
  // Not a quality cut — a producer whose grounding family is absent is rejected by its own parse
  // gate and declines its own floor, so the brief's plays are identical either way (see
  // lib/skills/first-brief-producers.ts). An explicit `skills` list always wins.
  const registry = opts.skills ?? PRODUCER_SKILLS
  const selection =
    opts.skills || !opts.firstBrief
      ? { run: registry, skipped: [] as ProducerSkipped[] }
      : selectFirstBriefProducers(registry, dossier.ruleOutputs.map((r) => r.insight_type))
  const skills = selection.run
  if (selection.skipped.length > 0) {
    console.log(
      `[runBrief] ${dossier.profile.locationId}: FIRST brief — running ${skills.length}/${registry.length} producers; ` +
        `skipped ${selection.skipped.map((s) => `${s.skillId}(${s.reason})`).join(", ")} ` +
        `(no citable evidence yet ⇒ each would have produced 0 plays)`,
    )
  }

  const skillResults = await runProducerSkills(skills, dossier, { ...t, previous: opts.previous })
  const candidates = skillResults.flatMap((r) => r.plays)

  // Per-producer health, captured BEFORE synthesis flattens the per-skill structure. Recorded onto
  // the brief so the pipeline watchdog can alert on fleet-wide fallback-serving (2026-06 truncation).
  const skillHealth: SkillHealth[] = [
    ...skillResults.map((r) => ({
      skillId: r.skillId,
      status: r.status,
      usedFallback: !!r.usedFallback,
      ...(r.fallbackReason ? { reason: r.fallbackReason } : {}),
      ...(typeof r.elapsedMs === "number" ? { elapsedMs: r.elapsedMs } : {}),
      ...(r.inputHash ? { inputHash: r.inputHash } : {}),
      ...(r.reused ? { reused: true } : {}),
      ...(r.tokens ? { tokens: r.tokens } : {}),
    })),
    // A SKIP IS NEVER SILENT. Same shape as every other slot, plus `skipped` and the reason, so
    // /admin/health and the watchdog read one uniform list. Deliberately carries no inputHash and
    // no tokens: nothing ran, so there is nothing to reuse tomorrow and nothing to bill today.
    ...selection.skipped.map(
      (s): SkillHealth => ({ skillId: s.skillId, status: "ok", usedFallback: false, skipped: true, reason: `${s.reason}: ${s.detail}` }),
    ),
  ]
  const reusedCount = skillResults.filter((r) => r.reused).length
  if (reusedCount > 0) console.log(`[runBrief] ${dossier.profile.locationId}: differential reuse ${reusedCount}/${skillResults.length} skills (input unchanged)`)
  // Differential builds: persist each producer's raw grounded plays so tomorrow's build can carry
  // them forward when that skill's inputHash is unchanged (Brief.plays only keeps synthesis survivors).
  const skillOutputs = Object.fromEntries(skillResults.map((r) => [r.skillId, r.plays]))
  const fellBack = skillHealth.filter((h) => h.usedFallback || h.status === "failed")
  if (fellBack.length > 0) {
    console.warn(
      `[runBrief] ${dossier.profile.locationId}: ${fellBack.length}/${skillHealth.length} producers degraded — ` +
        fellBack.map((h) => `${h.skillId}(${h.status === "failed" ? "failed" : h.reason ?? "fallback"})`).join(", "),
    )
  }

  // Differential builds Phase 2: fingerprint the downstream inputs on EVERY build (stamped on the
  // brief so tomorrow can compare), then decide whether the whole downstream stage can carry
  // forward. Fail-soft, mirroring the per-skill hash: a fingerprint error must never break a build
  // (fingerprint stays undefined → no stamp, no reuse today or tomorrow → full downstream).
  let downstreamFp: string | undefined
  try {
    downstreamFp = downstreamFingerprint(collectDownstreamInputs(dossier, skillResults, opts))
  } catch (err) {
    console.warn(
      `[runBrief] ${dossier.profile.locationId}: downstream fingerprint failed (downstream reuse disabled for this build):`,
      err,
    )
  }
  const downstreamDecision = decideDownstreamReuse({ skillResults, previous: opts.previous, todayFingerprint: downstreamFp })

  if (downstreamDecision.reuse && opts.previous?.downstream) {
    // Every producer carried yesterday's plays forward AND every downstream input (suppressions,
    // evergreen, multipliers, tolerance, priors, profile) is byte-identical, so yesterday's
    // downstream OUTPUT is still a valid answer — carry it forward instead of paying for the harm
    // review + Opus synthesis + write again. VISIBLE, not silent: providerStats.downstreamReused
    // marks the brief, and the log line below mirrors the producer-reuse line. Fresh per-day bits
    // are still recomputed deterministically: asOf/coverage from today's dossier, the voice scrub
    // (compliance floor tracks today's rules), and — in the shared tail — evalCheck + judge ground
    // truth, none of which cost a model call. The presenter is NOT re-run: the carried plays are
    // already post-presenter, and re-presenting against today's (volatile) dossier could rewrite
    // evidence that yesterday's build already grounded.
    const ds = opts.previous.downstream
    console.log(
      `[runBrief] ${dossier.profile.locationId}: downstream reused — all ${skillResults.length} producers unchanged and downstream inputs identical; skipped harm review + synthesis + write (differential Phase 2)`,
    )
    const carried: Brief = {
      locationId: dossier.locationId,
      dateKey: dossier.dateKey,
      headline: ds.headline,
      deck: ds.deck,
      plays: ds.plays,
      asOf: dossier.generatedAt,
      coverage: dossier.coverage ?? buildCoverage(dossier),
    }
    const providerStats: Brief["providerStats"] = {
      ...collectProviderStats(providerAtStart, dossier.profile.locationId, selection.skipped.length),
      downstreamReused: true,
    }
    const voiced: Brief = {
      ...(await voicePass(carried)),
      skillHealth,
      skillOutputs,
      providerStats,
      ...(downstreamFp ? { downstreamFingerprint: downstreamFp } : {}),
    }
    // No harm review ran, so nothing was dropped TODAY — yesterday's drops already shaped ds.plays.
    return { brief: finalizeBrief(voiced, dossier), skillResults, dropped: [] }
  }
  if (skillResults.length > 0 && reusedCount === skillResults.length && !downstreamDecision.reuse) {
    // All producers reused but downstream still runs — say why, so a "should have been free" day
    // is explainable from the logs instead of looking like a silent miss.
    console.log(`[runBrief] ${dossier.profile.locationId}: downstream NOT reused — ${downstreamDecision.reason}`)
  }

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
  const providerStats = collectProviderStats(providerAtStart, dossier.profile.locationId, selection.skipped.length)

  const presented = presentBrief(written, dossier)
  const voiced: Brief = {
    ...(await voicePass(presented)),
    skillHealth,
    skillOutputs,
    providerStats,
    // Phase 2: stamp the downstream-input fingerprint so TOMORROW's build can compare against it.
    // Absent (fingerprint failed) means this brief can never seed a downstream reuse.
    ...(downstreamFp ? { downstreamFingerprint: downstreamFp } : {}),
  }

  return { brief: finalizeBrief(voiced, dossier), skillResults, dropped }
}

/** Anthropic call/token/spend telemetry for THIS build — the per-model delta between the start
 *  snapshot and now. Same cross-build-approximate caveat as `requests` on a shared Fluid instance;
 *  fine for a trend. Shared by the generated path and the Phase 2 downstream-reuse path (where the
 *  delta is normally zero — recording that zero is exactly what makes a reused day visible in
 *  spend analysis). */
function collectProviderStats(
  providerAtStart: { requests: number; rateLimited: number; tokensByModel: Record<string, ModelTokenTotals> },
  locationId: string,
  /** First-brief readiness gating: how many producers were not called. 0 on every nightly build,
   *  and omitted from the stamp at 0 so a nightly brief's providerStats is byte-identical. */
  producersSkipped = 0,
): NonNullable<Brief["providerStats"]> {
  const providerAtEnd = anthropicCallStats()
  // Token telemetry (2026-07-16): per-model delta between the two snapshots — THIS build's tokens.
  const tokensByModel = deltaTokensByModel(providerAtStart.tokensByModel, providerAtEnd.tokensByModel)
  const tokenTotals = Object.values(tokensByModel).reduce(
    (acc, t) => ({
      inputTokens: acc.inputTokens + t.inputTokens,
      outputTokens: acc.outputTokens + t.outputTokens,
      cacheWriteTokens: acc.cacheWriteTokens + t.cacheWriteTokens,
      cacheReadTokens: acc.cacheReadTokens + t.cacheReadTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
  )
  // Spend for this build, priced with the same table /admin/health uses. Recorded unconditionally:
  // a week of these figures is what lets the per-brief ceiling and the fleet daily cap be set to a
  // multiple of observed spend instead of to an invented number.
  const estimatedUsd = estimateAnthropicCostUsd(tokensByModel)
  const budget = currentSpendBudget()
  if (budget && budget.degradedCalls > 0) {
    console.warn(
      `[runBrief] ${locationId}: spend ceiling degraded ${budget.degradedCalls} call(s) ` +
        `(peak≈$${budget.peakSpendUsd.toFixed(4)} vs ceiling $${budget.ceilingUsd.toFixed(4)}, final≈$${estimatedUsd.toFixed(4)})`,
    )
  }
  return {
    requests: providerAtEnd.requests - providerAtStart.requests,
    rateLimited: providerAtEnd.rateLimited - providerAtStart.rateLimited,
    ...(Object.keys(tokensByModel).length > 0 ? { ...tokenTotals, tokensByModel } : {}),
    ...(estimatedUsd > 0 ? { estimatedUsd } : {}),
    ...(budget ? { spendCeilingUsd: budget.ceilingUsd, spendDegradedCalls: budget.degradedCalls } : {}),
    ...(producersSkipped > 0 ? { producersSkipped } : {}),
  }
}

/** The shared build tail: eval recorder + judge ground truth. Runs on BOTH the generated path and
 *  the Phase 2 downstream-reuse path — the deterministic checks cost no model call, and re-running
 *  them on a reused day (rather than carrying yesterday's evalCheck forward) means the recorded
 *  verdict always reflects TODAY's rules and TODAY's dossier. Absence still means "not evaluated". */
function finalizeBrief(voiced: Brief, dossier: Dossier): Brief {
  // Eval recorder (step 3): run the deterministic anti-fabrication checks over the FINAL brief —
  // what the operator actually reads, after presenter + voice. Observation only: never throws, never
  // mutates plays, costs no model call. Absence of the field means "not evaluated", not "clean".
  const evalCheck = recordBriefEval(voiced, dossier)
  logEvalRecord(dossier.profile.locationId, evalCheck)
  // Ground truth for the nightly judge, captured HERE because the dossier is not persisted and
  // rebuilding it later would hit paid vendors. Fail-soft: a capture failure just omits the field.
  const gt = briefGroundTruth(dossier)
  return {
    ...voiced,
    ...(evalCheck ? { evalCheck } : {}),
    ...(gt ? { judgeGroundTruth: gt.summary, ...(gt.truncated ? { judgeGroundTruthTruncated: true } : {}) } : {}),
  }
}

/**
 * Assemble the Phase 2 downstream-input fingerprint payload from the live build (differential.ts
 * keeps the pure hash + decision; the dossier/options glue lives here, next to the objects).
 * Captures everything the harm review + synthesis + write depend on BEYOND the producer outputs:
 * per-skill input hashes, the P7a suppression set, the P7b evergreen pool (content + whether each
 * play's refs resolve against today's dossier), the P15 multiplier values probed over every
 * candidate play's play_type_key at every severity band (the harm review stamps severity later, so
 * a rollup change confined to a bold/wild band must still break the match), the tolerance slider,
 * category priors, maxPlays, and the profile framing the prompts embed. Shadow multipliers are
 * deliberately EXCLUDED — they never affect the served brief. Exported for unit tests.
 */
export function collectDownstreamInputs(
  dossier: Dossier,
  skillResults: Pick<SkillResult, "skillId" | "inputHash" | "plays">[],
  opts: Pick<RunBriefOptions, "suppressedKeys" | "evergreen" | "playTypeMultipliers" | "maxPlays">,
): DownstreamFingerprintInputs {
  const lookup = opts.playTypeMultipliers ?? NEUTRAL_LOOKUP
  const keyOf = (p: EnrichedRecommendation) =>
    computePlayTypeKey(p, { leadDomainOverride: LEAD_DOMAIN_BY_SKILL[p.skillId] })
  const playTypeMultipliers: Record<string, number> = {}
  const probeMultipliers = (p: EnrichedRecommendation) => {
    for (const severity of [0, 2, 3]) {
      // 0/2/3 cover the three severity bands (tame/bold/wild); undefined severity keys as tame too.
      const k = keyOf({ ...p, severity })
      playTypeMultipliers[k] = lookup.multiplierFor(k)
    }
  }
  for (const r of skillResults) r.plays.forEach(probeMultipliers)

  const allowedRefs = buildRefIndex(dossier).allowedRefs
  const evergreen = (opts.evergreen ?? [])
    .map((p) => ({
      key: playKey(p),
      play: p,
      resolvable: (p.evidenceRefs?.length ?? 0) > 0 && p.evidenceRefs.every((ref) => allowedRefs.has(ref)),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  ;(opts.evergreen ?? []).forEach(probeMultipliers)

  return {
    skillHashes: Object.fromEntries(skillResults.map((r) => [r.skillId, r.inputHash ?? null])),
    suppressedKeys: [...(opts.suppressedKeys ?? [])].sort(),
    evergreen,
    playTypeMultipliers,
    brandTolerance: dossier.profile.brandTolerance ?? 50,
    categoryPriors: dossier.profile.categoryPriors ?? null,
    maxPlays: opts.maxPlays ?? null,
    profile: { name: dossier.profile.name, attributes: dossier.profile.attributes, voiceTone: dossier.profile.voiceTone },
  }
}
