// Phase 7 — recommendation content + voice. Locks in: phone-first creative direction
// (no photography jargon / assumed gear), and the shared skill prompt's phone-first +
// optional-advanced + multi-channel + onboarding-brand-voice instructions.

import { describe, it, expect } from "vitest"
import { runProducerSkills } from "@/lib/skills/run"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { buildSkillPrompt } from "@/lib/skills/prompt-kit"
import { marketingSkill } from "@/lib/skills/marketing/skill"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import { patioWeatherDossier } from "@/tests/fixtures/dossiers/patio-weather"
import type { Transport } from "@/lib/ai/provider"

// deterministic fallback path (no live model)
const failing: Transport = async () => {
  throw new Error("offline")
}

const PHOTO_JARGON = /golden hour|side light|tight crop|no text overlay|\bthe sear\b|\bplating\b|DSLR|tripod|softbox/i

describe("phase 7 — phone-first creative direction", () => {
  it("no deterministic creative direction uses photography jargon, and creatives are phone-first", async () => {
    const directions: string[] = []
    for (const d of [competitiveWeekDossier, patioWeatherDossier]) {
      const results = await runProducerSkills(PRODUCER_SKILLS, d, { transport: failing })
      for (const r of results) for (const p of r.plays ?? []) for (const s of p.recipe) {
        if (s.creativeDirection) directions.push(s.creativeDirection)
      }
    }
    expect(directions.length).toBeGreaterThan(0)
    for (const cd of directions) expect(cd, cd).not.toMatch(PHOTO_JARGON)
    expect(directions.some((cd) => /phone/i.test(cd))).toBe(true)
  })
})

describe("phase 7 — shared skill prompt rules", () => {
  // The rules live across the cached (stable) and volatile system blocks — assert on
  // the combined text the model actually receives.
  const built = buildSkillPrompt(marketingSkill, competitiveWeekDossier, {})
  const system = [built.systemCached, built.system].filter(Boolean).join("\n")

  it("instructs phone-first creative with no assumed equipment", () => {
    expect(system).toMatch(/PHONE-FIRST/)
    expect(system).toMatch(/no special equipment/i)
    expect(system).toMatch(/photography jargon/i)
  })
  it("marks more-produced creative as optional", () => {
    expect(system).toMatch(/optional/i)
  })
  it("gives multi-channel guidance by platform name", () => {
    expect(system).toMatch(/Instagram and TikTok/i)
  })
  it("instructs relevant hashtags on social copy drafts only", () => {
    expect(system).toMatch(/hashtags/i)
    // scoped to social copy drafts, never spam, never a fabricated brand
    expect(system).toMatch(/social/i)
    expect(system).toMatch(/never spam/i)
  })
  it("ties customer copy to the onboarding brand voice", () => {
    expect(system).toMatch(/onboarding/i)
    expect(system).toMatch(/customer copy in Ticket's voice/i)
  })
})
