import { describe, it, expect } from "vitest"
import { applyHarmReview, reviewPlays, type HarmVerdict } from "@/lib/skills/safety-review"
import { runBrief } from "@/lib/skills/pipeline"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { evaluateBrief } from "@/lib/eval/checks"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { Transport } from "@/lib/ai/provider"

function play(title: string, confidence: EnrichedRecommendation["confidence"]): EnrichedRecommendation {
  return {
    title,
    rationale: "r",
    skillId: "x",
    ownerRole: "owner",
    kind: "positioning",
    recipe: [{ channel: "c", platforms: [], audience: "a", window: { note: "w" } }],
    confidence,
    evidenceRefs: ["menu.price_positioning_shift"],
    knowledgeVersion: "x@v1",
  }
}

describe("applyHarmReview (graduated)", () => {
  it("drops severe, downgrades moderate to directional and mild by one step", () => {
    const plays = [play("a", "high"), play("b", "high"), play("c", "medium"), play("d", "high")]
    const verdicts: HarmVerdict[] = [
      { index: 0, severity: 3, reason: "off-brand" },
      { index: 1, severity: 2, reason: "moderate" },
      { index: 2, severity: 1, reason: "mild" },
      { index: 3, severity: 0, reason: "" },
    ]
    const { kept, dropped } = applyHarmReview(plays, verdicts)
    expect(dropped.map((d) => d.play.title)).toEqual(["a"])
    expect(kept.find((p) => p.title === "b")?.confidence).toBe("directional") // moderate -> lowest
    expect(kept.find((p) => p.title === "c")?.confidence).toBe("directional") // medium downgraded one
    expect(kept.find((p) => p.title === "d")?.confidence).toBe("high") // none unchanged
  })

  it("matches verdicts to plays by POSITION, not the model's index field (ENG-Low L2)", () => {
    const plays = [play("a", "high"), play("b", "high")]
    // The model returned a duplicate index 0 for both verdicts. Positional matching must still drop
    // play b (the severe verdict at position 1); the old byIndex map collapsed these (last-wins) and
    // left b with no verdict -> severity 0 -> kept (a tone-deaf play slipping through).
    const verdicts: HarmVerdict[] = [
      { index: 0, severity: 0, reason: "" },
      { index: 0, severity: 3, reason: "severe" },
    ]
    const { dropped } = applyHarmReview(plays, verdicts)
    expect(dropped.map((d) => d.play.title)).toEqual(["b"])
  })
})

describe("reviewPlays parsing (mock)", () => {
  it("coerces model JSON into clamped verdicts", async () => {
    const transport: Transport = async () => [
      { index: 0, severity: 9, reason: "x" }, // clamps to 0 (invalid)
      { index: 1, severity: 3, reason: "severe" },
    ]
    const verdicts = await reviewPlays(competitiveWeekDossier, [play("a", "high"), play("b", "high")], { transport })
    expect(verdicts[0].severity).toBe(0)
    expect(verdicts[1].severity).toBe(3)
  })
})

describe("runBrief with graduated review", () => {
  it("drops a play the reviewer marks severe, still yields a grounded eval-clean brief", async () => {
    // One transport drives producers (throw->fallback), reviewer, and synthesis.
    const transport: Transport = async (req) => {
      const sys = req.system ?? ""
      if (sys.includes("brand-fit reviewer")) return [{ index: 0, severity: 3, reason: "off-brand for this place" }]
      if (sys.includes("Chief of Staff")) return { headline: "Test", deck: "Deck", order: [0, 1] }
      throw new Error("force producer fallback")
    }
    const { brief, dropped } = await runBrief(competitiveWeekDossier, { transport })
    expect(dropped.length).toBe(1) // the severe play was dropped
    const index = buildRefIndex(competitiveWeekDossier)
    for (const p of brief.plays) expect(p.evidenceRefs.every((r) => index.allowedRefs.has(r))).toBe(true)
    expect(evaluateBrief({ plays: brief.plays }, index).ok).toBe(true)
  })
})
