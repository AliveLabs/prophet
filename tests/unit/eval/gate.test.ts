import { describe, it, expect } from "vitest"
import { runEvalGate } from "@/lib/eval/gate"
import { buildBaselineBrief } from "@/lib/eval/baseline"
import { runProducerSkills } from "@/lib/skills/run"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { synthesize } from "@/lib/skills/synthesis"
import { voicePass } from "@/lib/skills/voice"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Transport } from "@/lib/ai/provider"
import type { GenerateFn } from "@/lib/eval/judge"

const failing: Transport = async () => {
  throw new Error("offline")
}

// Mock judge: the legacy baseline serializes plays with `"recipe": []`; the new engine's
// plays have real recipe steps. Score the engine high, the recipe-less baseline low.
const mockJudge: GenerateFn = async (prompt) => {
  const isBaseline = prompt.includes('"recipe": []')
  const n = isBaseline ? 2 : 4.5
  return JSON.stringify({
    scores: { specificity: n, nonObviousness: n, actionableSmallBudget: n, groundingFaithfulness: isBaseline ? 3 : 4.5 },
    toneDeaf: [],
    notes: "",
  })
}

describe("eval gate", () => {
  it("builds a baseline brief from the dossier's existing recommendations (no recipes)", () => {
    const b = buildBaselineBrief(competitiveWeekDossier)
    expect(b.plays.length).toBeGreaterThan(0)
    expect(b.plays.every((p) => p.recipe.length === 0)).toBe(true)
    expect(b.plays.every((p) => competitiveWeekDossier.ruleOutputs.some((r) => r.insight_type === p.evidenceRefs[0]))).toBe(true)
  })

  it("scores the new engine above the legacy baseline and passes the gate", async () => {
    const results = await runProducerSkills(PRODUCER_SKILLS, competitiveWeekDossier, { transport: failing })
    const candidate = await voicePass(await synthesize(competitiveWeekDossier, results, { transport: failing }))
    const report = await runEvalGate(competitiveWeekDossier, candidate, { generate: mockJudge })
    expect(report.candidate.overall).toBeGreaterThan(report.baseline.overall)
    expect(report.gate.pass).toBe(true)
  })

  it("fails the gate when the candidate does not beat the baseline", async () => {
    const flat: GenerateFn = async () =>
      JSON.stringify({ scores: { specificity: 3, nonObviousness: 3, actionableSmallBudget: 3, groundingFaithfulness: 3 }, toneDeaf: [], notes: "" })
    const results = await runProducerSkills(PRODUCER_SKILLS, competitiveWeekDossier, { transport: failing })
    const candidate = await voicePass(await synthesize(competitiveWeekDossier, results, { transport: failing }))
    const report = await runEvalGate(competitiveWeekDossier, candidate, { generate: flat })
    expect(report.gate.pass).toBe(false) // no margin over baseline
  })
})
