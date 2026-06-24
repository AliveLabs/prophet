// Producer-skill registry. The full vision is the target; we ship a real subset
// at a time, each eval-gated. Add a skill here once its knowledge + schema are real.

import type { ProducerSkill } from "@/lib/skills/skill-types"
import { localDemandSkill } from "@/lib/skills/local-demand/skill"
import { positioningSkill } from "@/lib/skills/positioning/skill"
import { marketingSkill } from "@/lib/skills/marketing/skill"
import { reputationSkill } from "@/lib/skills/reputation/skill"
import { operationsSkill } from "@/lib/skills/operations/skill"
import { foodPairingSkill } from "@/lib/skills/food-pairing/skill"
import { guerrillaMarketingSkill } from "@/lib/skills/guerrilla-marketing/skill"
import { socialCounterSkill } from "@/lib/skills/social-counter/skill"
import { convergenceSkill } from "@/lib/skills/convergence/skill"

export const PRODUCER_SKILLS: ProducerSkill[] = [
  localDemandSkill,
  positioningSkill,
  marketingSkill,
  reputationSkill,
  operationsSkill,
  // P6 expert roster — two specialist producers feeding the SAME global pool (no per-expert cap).
  // food-pairing = the kitchen (what to feature, when); guerrilla = zero-budget hyper-local growth.
  // Both run on the standard reasoning tier (not the deep pass).
  foodPairingSkill,
  guerrillaMarketingSkill,
  // P12 — social counter-strategy: reads a rival's winning posts (ranked by engagement RATE),
  // diagnoses the winning pattern, and emits a phone-shootable counter-play. Its own `social`
  // category (neutral prior), standard reasoning tier. Grounds on the social.* rule outputs.
  socialCounterSkill,
  // P5: cross-domain convergence — sees the WHOLE dossier, runs on the deep (Opus + thinking)
  // pass, feeds the same global pool. Last so the domain experts' plays are produced alongside it.
  convergenceSkill,
]

export function getProducerSkill(id: string): ProducerSkill | undefined {
  return PRODUCER_SKILLS.find((s) => s.id === id)
}
