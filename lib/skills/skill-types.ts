// ---------------------------------------------------------------------------
// Skill type contracts (Phase 3). Pure types — kept separate so the registry,
// the run harness, and individual skills can all import without cycles.
// A producer skill = a domain expert that reads the dossier and emits grounded,
// recipe-level recommendations. Meta skills (synthesis, voice) are separate.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { EnrichedRecommendation, OwnerRole, RecKind } from "@/lib/skills/types"
import type { ModelTier } from "@/lib/ai/provider"

export type ProducerSkill = {
  id: string
  displayName: string
  /** Which restaurant role acts on this skill's plays (drives UI routing). */
  ownerRole: OwnerRole
  /** The kind every play from this skill carries. */
  kind: RecKind
  tier: ModelTier
  temperature: number
  knowledgeVersion: string
  /** The domain playbook (expert priors), authored as prose. */
  knowledge: string
  /** Build the system + user prompt for this skill from the dossier (input selection lives here). */
  buildPrompt: (d: Dossier) => { system: string; prompt: string }
  /** Coerce model JSON into plays; return null to trigger the deterministic fallback. */
  parse: (raw: unknown, d: Dossier) => EnrichedRecommendation[] | null
  /** Deterministic, grounded fallback when the model fails/returns junk. Never fabricates. */
  fallback: (d: Dossier) => EnrichedRecommendation[]
}

export type SkillResult = {
  skillId: string
  status: "ok" | "failed"
  plays: EnrichedRecommendation[]
  error?: string
}
