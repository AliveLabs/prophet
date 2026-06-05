// Cross-scenario golden-set test: run the full engine (deterministic fallback path,
// no live model) over each manufactured dossier and assert the brief is real,
// grounded, eval-clean and voice-clean — or an honest quiet brief.

import { describe, it, expect } from "vitest"
import { runProducerSkills } from "@/lib/skills/run"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { synthesize } from "@/lib/skills/synthesis"
import { voicePass, isVoiceClean } from "@/lib/skills/voice"
import { evaluateBrief } from "@/lib/eval/checks"
import { buildRefIndex, type Dossier } from "@/lib/insights/dossier/types"
import { arenaWeekDossier } from "@/tests/fixtures/dossiers/arena-week"
import { patioWeatherDossier } from "@/tests/fixtures/dossiers/patio-weather"
import { quietWeekDossier } from "@/tests/fixtures/dossiers/quiet-week"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import { runProducerSkill } from "@/lib/skills/run"
import { marketingSkill } from "@/lib/skills/marketing/skill"
import { reputationSkill } from "@/lib/skills/reputation/skill"
import { positioningSkill } from "@/lib/skills/positioning/skill"
import type { Transport } from "@/lib/ai/provider"

// Force the deterministic fallback path everywhere (no live calls, fully reproducible).
const failing: Transport = async () => {
  throw new Error("offline")
}

async function run(d: Dossier) {
  const results = await runProducerSkills(PRODUCER_SKILLS, d, { transport: failing })
  return voicePass(await synthesize(d, results, { transport: failing }))
}

describe("golden-set scenarios (deterministic engine)", () => {
  for (const { name, dossier } of [
    { name: "arena-week", dossier: arenaWeekDossier },
    { name: "patio-weather", dossier: patioWeatherDossier },
    { name: "competitive-week", dossier: competitiveWeekDossier },
  ]) {
    it(`${name}: yields a real, grounded, eval-clean, voice-clean brief`, async () => {
      const brief = await run(dossier)
      const index = buildRefIndex(dossier)
      expect(brief.plays.length).toBeGreaterThan(0)
      // weekly brief = the deep spine (cap 7); a daily glance trims further
      expect(brief.plays.length).toBeLessThanOrEqual(7)
      for (const p of brief.plays) {
        expect(p.evidenceRefs.length).toBeGreaterThan(0)
        expect(p.evidenceRefs.every((r) => index.allowedRefs.has(r))).toBe(true)
      }
      expect(evaluateBrief({ plays: brief.plays }, index).ok).toBe(true)
      expect(isVoiceClean(brief)).toBe(true)
    })
  }

  it("competitive-week: marketing, reputation, and positioning each fire and stay grounded", async () => {
    const index = buildRefIndex(competitiveWeekDossier)
    for (const skill of [marketingSkill, reputationSkill, positioningSkill]) {
      const res = await runProducerSkill(skill, competitiveWeekDossier, { transport: failing })
      expect(res.status).toBe("ok")
      expect(res.plays.length).toBeGreaterThan(0)
      for (const p of res.plays) {
        expect(p.skillId).toBe(skill.id)
        expect(p.evidenceRefs.every((r) => index.allowedRefs.has(r))).toBe(true)
      }
    }
  })

  it("quiet-week: produces an honest quiet brief with no fabricated plays", async () => {
    const brief = await run(quietWeekDossier)
    expect(brief.plays.length).toBe(0)
    expect(brief.headline.toLowerCase()).toContain("quiet")
    expect(isVoiceClean(brief)).toBe(true)
  })
})
