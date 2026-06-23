// PV (vision → positioning): the positioning skill now folds the Gemini Vision profile
// (EntityVisualProfile on d.location.visual) into its prompt as a DISTILLED positioning read,
// and behaves byte-identically when there is no vision data (many orgs have none yet).

import { describe, it, expect } from "vitest"
import { positioningSkill } from "@/lib/skills/positioning/skill"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { EntityVisualProfile, SocialPostAnalysis } from "@/lib/social/types"

function postAnalysis(over: Partial<SocialPostAnalysis>): SocialPostAnalysis {
  return {
    contentCategory: "food_dish",
    subcategory: "",
    tags: [],
    extractedText: "",
    foodPresentation: { platingQuality: "high", portionAppeal: "generous", colorVibrancy: "vibrant" },
    visualQuality: { lighting: "professional", composition: "professional", editing: "polished" },
    brandSignals: { logoVisible: true, brandColorsPresent: true, visualStyleConsistency: "on_brand" },
    atmosphereSignals: { crowdLevel: "packed", energy: "high", timeOfDay: "evening" },
    promotionalContent: false,
    promotionalDetails: "",
    confidence: 0.9,
    ...over,
  }
}

const visual: EntityVisualProfile = {
  entityType: "location",
  entityId: "loc-wagyu",
  entityName: "Wagyu House Atlanta",
  platform: "instagram",
  contentMix: { food_dish: 0.6, interior_ambiance: 0.3, repost_meme: 0.1 },
  avgVisualQualityScore: 88,
  professionalContentPct: 72,
  foodPresentationScore: 91,
  brandConsistencyScore: 84,
  promotionalContentPct: 10,
  crowdSignalScore: 70,
  postAnalyses: [
    { postId: "p1", analysis: postAnalysis({}), engagement: 120 },
    { postId: "p2", analysis: postAnalysis({ contentCategory: "interior_ambiance", atmosphereSignals: { crowdLevel: "busy", energy: "relaxed", timeOfDay: "day" } }), engagement: 80 },
  ],
}

const withVisual = (v: EntityVisualProfile | null): Dossier => ({
  ...competitiveWeekDossier,
  location: { ...competitiveWeekDossier.location, visual: v },
})

describe("positioning skill — PV vision wiring", () => {
  it("folds the distilled visual read into the prompt (scores + top content + atmosphere)", () => {
    const { prompt } = positioningSkill.buildPrompt(withVisual(visual))
    expect(prompt).toContain("visualProfile")
    expect(prompt).toContain("foodPresentationScore")
    expect(prompt).toContain("food_dish") // dominant content the camera points at
    expect(prompt).toContain("packed") // atmosphere cue
  })

  it("does NOT dump the raw postAnalyses array (token-budget-aware synthesis)", () => {
    const { prompt } = positioningSkill.buildPrompt(withVisual(visual))
    expect(prompt).not.toContain("postAnalyses")
    expect(prompt).not.toContain("postId")
  })

  it("teaches the model to treat the look as a positioning proof point (knowledge)", () => {
    const { systemCached } = positioningSkill.buildPrompt(withVisual(visual))
    expect(systemCached).toContain("WHAT THE PLACE LOOKS LIKE")
  })

  it("ABSENCE GUARD: no visual -> prompt omits visualProfile entirely (pre-PV behavior)", () => {
    const { prompt } = positioningSkill.buildPrompt(withVisual(null))
    expect(prompt).not.toContain("visualProfile")
  })

  it("ABSENCE GUARD: an empty/zero visual profile is treated as no signal", () => {
    const empty: EntityVisualProfile = {
      ...visual,
      contentMix: {},
      avgVisualQualityScore: 0,
      professionalContentPct: 0,
      foodPresentationScore: 0,
      brandConsistencyScore: 0,
      promotionalContentPct: 0,
      crowdSignalScore: 0,
      postAnalyses: [],
    }
    const { prompt } = positioningSkill.buildPrompt(withVisual(empty))
    expect(prompt).not.toContain("visualProfile")
  })

  it("version bumped to positioning@v3", () => {
    expect(positioningSkill.knowledgeVersion).toBe("positioning@v3")
  })
})
