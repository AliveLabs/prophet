// ---------------------------------------------------------------------------
// Skill type contracts (Phase 3). Pure types — kept separate so the registry,
// the run harness, and individual skills can all import without cycles.
// A producer skill = a domain expert that reads the dossier and emits grounded,
// recipe-level recommendations. Meta skills (synthesis, voice) are separate.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { Category, EnrichedRecommendation, OwnerRole, RecKind } from "@/lib/skills/types"
import type { ModelTier } from "@/lib/ai/provider"
import type { KnowledgeInjection } from "@/lib/skills/knowledge-feeds"

// ── Learning Spine L0 (P14) — the opt-in per-skill learning hook ──────────────────────────────────
// Declares, per skill: which signal STREAMS it consumes, its play_type_key lead-domain (used by the
// feedback rollup, P15), and which learning_kinds it accepts into its prompt. OPT-IN: a skill with no
// hook behaves EXACTLY as today (the loader still returns the floor; nothing changes). Adding a hook
// is purely declarative metadata — it does not, by itself, alter prompt building or scoring.
export type LearningStream = "external" | "click" | "ask"
export type LearningKind = "external_trend" | "feedback_pattern" | "question_demand" | "editorial"

export type SkillLearningHook = {
  /** Which of the three signal streams this skill consumes. */
  streams: LearningStream[]
  /** Stable lead-domain for this skill's play_type_key (feedback rollup keying — P15). */
  playTypeLeadDomain: string
  /** Which learning_kinds this skill accepts INTO its prompt. A kind not listed here is never injected
   *  for this skill even if an active row exists (defense in depth alongside the per-skill scope). */
  acceptedLearningKinds: LearningKind[]
}

export type ProducerSkill = {
  id: string
  displayName: string
  /** Which restaurant role acts on this skill's plays (drives UI routing). */
  ownerRole: OwnerRole
  /** The kind every play from this skill carries. */
  kind: RecKind
  /** The operator-facing DOMAIN every play from this skill belongs to (drives scoring
   *  priors, drill-down, and per-operator rerank). Intrinsic — not derived from kind. */
  category: Category
  tier: ModelTier
  /** P5: run this skill on the DEEP pass (Opus + adaptive thinking) instead of the default
   *  Sonnet reasoning tier. Used by the cross-domain convergence skill. Producers leave it unset. */
  deep?: boolean
  /** Adaptive-thinking effort for this producer's model call. Defaults to "medium" in run.ts.
   *  Override to "low" for a skill whose prompt is heavy enough that medium-effort thinking risks the
   *  120s timeout (which silently degrades it to the deterministic fallback). guerrilla-marketing was
   *  timing out at medium (~>120s on a 40k-char prompt) → 0 plays; at "low" it completes in ~74s with
   *  full-quality anchored plays. (2026-06-25.) */
  effort?: "low" | "medium" | "high"
  temperature: number
  knowledgeVersion: string
  /** The domain playbook (expert priors), authored as prose. */
  knowledge: string
  /** Build the prompts for this skill from the dossier (input selection lives here).
   *  systemCached = the stable, byte-identical-across-locations prefix (cached);
   *  system = the volatile per-location context, after the cache breakpoint.
   *  P14: an OPTIONAL pre-fetched `knowledge` injection adds the "CURRENT TRENDS & LEARNED PRIORS"
   *  block (global → cached prefix, scoped → volatile block). Absent → byte-identical to today. */
  buildPrompt: (d: Dossier, knowledge?: KnowledgeInjection) => { systemCached?: string; system: string; prompt: string }
  /** Coerce model JSON into plays; return null to trigger the deterministic fallback. */
  parse: (raw: unknown, d: Dossier) => EnrichedRecommendation[] | null
  /** Deterministic, grounded fallback when the model fails/returns junk. Never fabricates. */
  fallback: (d: Dossier) => EnrichedRecommendation[]
  /** P14: OPT-IN learning hook (which streams/kinds this skill consumes). Absence = today's behavior. */
  learning?: SkillLearningHook
  /** The exact dossier slice this skill reads (the same function buildPrompt uses). Differential
   *  builds hash this: identical slice + knowledge since yesterday → the expert has nothing new to
   *  look at → reuse yesterday's real plays instead of a model call. Do NOT hash the built prompt
   *  (dateKey leaks into prompt text → zero reuse ever). */
  selectInput?: (d: Dossier) => unknown
}

export type SkillResult = {
  skillId: string
  status: "ok" | "failed"
  plays: EnrichedRecommendation[]
  error?: string
  /** true when this producer served its DETERMINISTIC fallback instead of real model output. A
   *  fallback still yields status "ok" (the brief builds), so this is the ONLY signal that the
   *  model path degraded — the gap that hid the 2026-06 fleet-wide truncation regression. */
  usedFallback?: boolean
  /** Why it fell back: truncated | timeout | rate_limited | transport_error | unparseable. */
  fallbackReason?: string
  /** Wall-clock ms for this producer's model call (incl. governor slot-wait). Feeds the fleet p95
   *  latency watch signal — rising p95 is the precursor to timeout-fallbacks. Absent on a throw. */
  elapsedMs?: number
  /** Differential builds: sha256 of (skill id + effective knowledge version + selectInput slice).
   *  Same hash tomorrow ⇒ the expert would see identical evidence ⇒ Phase 1 reuses instead of calling. */
  inputHash?: string
  /** Differential builds: true when this result carried yesterday's real plays forward (no model
   *  call). Never true for a fallback-served run (those are excluded from reuse at extraction). */
  reused?: boolean
  /** Anthropic token usage for this producer's model call (2026-07-16 cost telemetry). Absent on
   *  reuse (no call) and on timeout-aborted fallbacks (the client never sees a usage block even
   *  though the server bills the generation — fallback days UNDERCOUNT). Feeds skillHealth.tokens
   *  → the /admin/health $/brief estimate. */
  tokens?: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number }
}
