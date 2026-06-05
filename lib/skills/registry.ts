// Producer-skill registry. The full vision is the target; we ship a real subset
// at a time, each eval-gated. Add a skill here once its knowledge + schema are real.

import type { ProducerSkill } from "@/lib/skills/skill-types"
import { localDemandSkill } from "@/lib/skills/local-demand/skill"
import { positioningSkill } from "@/lib/skills/positioning/skill"
import { marketingSkill } from "@/lib/skills/marketing/skill"
import { reputationSkill } from "@/lib/skills/reputation/skill"
import { operationsSkill } from "@/lib/skills/operations/skill"

export const PRODUCER_SKILLS: ProducerSkill[] = [
  localDemandSkill,
  positioningSkill,
  marketingSkill,
  reputationSkill,
  operationsSkill,
]

export function getProducerSkill(id: string): ProducerSkill | undefined {
  return PRODUCER_SKILLS.find((s) => s.id === id)
}
