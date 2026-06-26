// GRASSROOTS VISIBILITY FLOOR (Bryan 2026-06-25): synthesize() must GUARANTEE at least one grassroots
// play surfaces when the pool has one — even though grassroots scores mid-pack (impact ~medium, but
// confidence medium/directional vs the high/high convergence+menu+social plays), so the selector would
// otherwise drop it. Category is derived from the skill registry: skillId "guerrilla-marketing" →
// grassroots; "marketing" → marketing. The `failing` transport forces the deterministic fallback
// (rankedPlays.slice(0,max)), which is the worst case for grassroots (pure score cutoff).

import { describe, it, expect } from "vitest"
import { synthesize } from "@/lib/skills/synthesis"
import type { SkillResult } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { Transport } from "@/lib/ai/provider"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"

const failing: Transport = async () => {
  throw new Error("model down")
}

const mkPlay = (over: Partial<EnrichedRecommendation>): EnrichedRecommendation => ({
  title: "t",
  rationale: "r",
  skillId: "marketing",
  ownerRole: "marketing",
  kind: "capitalize",
  recipe: [{ channel: "c", platforms: [], audience: "a", window: { note: "this week" } }],
  confidence: "high",
  leverage: { label: "high", basisInternal: "b" },
  evidenceRefs: ["events.weekend_density_spike"],
  knowledgeVersion: "marketing@v1",
  ...over,
})

const categories = (b: { plays: { category?: string }[] }) => b.plays.map((p) => p.category)

describe("synthesize() grassroots visibility floor", () => {
  it("guarantees the best grassroots play a slot even when it ranks below the cut", async () => {
    const strong = [
      mkPlay({ title: "A", evidenceRefs: ["events.weekend_density_spike"] }),
      mkPlay({ title: "B", evidenceRefs: ["traffic.new_slow_period"] }),
      mkPlay({ title: "C", evidenceRefs: ["social.posting_frequency_gap"] }),
    ]
    // grassroots play scores LOW (directional confidence) → would be cut by a pure rank slice.
    const grass = mkPlay({
      title: "Spirit night with the local school",
      skillId: "guerrilla-marketing",
      confidence: "directional",
      leverage: { label: "medium", basisInternal: "b" },
      evidenceRefs: ["traffic.competitive_opportunity"],
    })
    const results: SkillResult[] = [{ skillId: "x", status: "ok", plays: [...strong, grass] }]
    const brief = await synthesize(competitiveWeekDossier, results, { transport: failing, maxPlays: 2 })
    expect(brief.plays).toHaveLength(2) // stays at the cap (displaced the weakest non-grassroots)
    expect(categories(brief)).toContain("grassroots") // floor pulled it in despite ranking below the cut
  })

  it("does not double-add when a grassroots play is already selected on merit", async () => {
    const grass = mkPlay({
      title: "Spirit night",
      skillId: "guerrilla-marketing",
      confidence: "high",
      leverage: { label: "high", basisInternal: "b" },
      evidenceRefs: ["traffic.new_slow_period"],
    })
    const other = mkPlay({ title: "A", evidenceRefs: ["events.weekend_density_spike"] })
    const results: SkillResult[] = [{ skillId: "x", status: "ok", plays: [grass, other] }]
    const brief = await synthesize(competitiveWeekDossier, results, { transport: failing, maxPlays: 2 })
    expect(categories(brief).filter((c) => c === "grassroots")).toHaveLength(1)
  })

  it("adds nothing when the pool has no grassroots play (no partners / none generated)", async () => {
    const results: SkillResult[] = [
      {
        skillId: "marketing",
        status: "ok",
        plays: [
          mkPlay({ title: "A", evidenceRefs: ["events.weekend_density_spike"] }),
          mkPlay({ title: "B", evidenceRefs: ["traffic.new_slow_period"] }),
        ],
      },
    ]
    const brief = await synthesize(competitiveWeekDossier, results, { transport: failing, maxPlays: 2 })
    expect(categories(brief)).not.toContain("grassroots")
  })
})
