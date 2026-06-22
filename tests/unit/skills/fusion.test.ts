// P6.5 — play fusion. clusterPlays() is pure; fuseNearDuplicates() merges near-dup clusters via an
// LLM call with a deterministic keep-best fallback and a keep-separate escape.

import { describe, it, expect, vi } from "vitest"
import { clusterPlays, fuseNearDuplicates } from "@/lib/skills/fusion"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { Transport } from "@/lib/ai/provider"

const mkPlay = (over: Partial<EnrichedRecommendation> = {}): EnrichedRecommendation => ({
  title: "t",
  rationale: "r",
  skillId: "marketing",
  ownerRole: "marketing",
  kind: "capitalize",
  recipe: [{ channel: "c", platforms: [], audience: "a", window: { note: "this week" } }],
  confidence: "medium",
  leverage: { label: "medium", basisInternal: "b" },
  evidenceRefs: ["social.behind_scenes_opportunity"],
  knowledgeVersion: "x@v1",
  ...over,
})

// scoreOf for the keep-best fallback: high confidence wins.
const scoreOf = (p: EnrichedRecommendation) => (p.confidence === "high" ? 100 : p.confidence === "medium" ? 50 : 10)

describe("clusterPlays (pure)", () => {
  it("clusters 2 plays with the same kind + lead ref from DIFFERENT skills", () => {
    const { clusters, singletons } = clusterPlays([
      mkPlay({ skillId: "marketing" }),
      mkPlay({ skillId: "guerrilla-marketing" }),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveLength(2)
    expect(singletons).toHaveLength(0)
  })
  it("does NOT cluster same-skill repeats (target is cross-lens overlap)", () => {
    const { clusters, singletons } = clusterPlays([mkPlay({ skillId: "marketing" }), mkPlay({ skillId: "marketing" })])
    expect(clusters).toHaveLength(0)
    expect(singletons).toHaveLength(2)
  })
  it("does NOT cluster across different kinds or different lead refs", () => {
    expect(
      clusterPlays([mkPlay({ skillId: "a", kind: "capitalize" }), mkPlay({ skillId: "b", kind: "ops" })]).clusters,
    ).toHaveLength(0)
    expect(
      clusterPlays([
        mkPlay({ skillId: "a", evidenceRefs: ["events.x"] }),
        mkPlay({ skillId: "b", evidenceRefs: ["menu.y"] }),
      ]).clusters,
    ).toHaveLength(0)
  })
  it("treats an ungrounded play as a singleton (never clusters on no evidence)", () => {
    const { clusters, singletons } = clusterPlays([mkPlay({ skillId: "a", evidenceRefs: [] }), mkPlay({ skillId: "b", evidenceRefs: [] })])
    expect(clusters).toHaveLength(0)
    expect(singletons).toHaveLength(2)
  })
  it("NEVER clusters a convergence play (it's already a cross-lens synthesis — must not be re-fused/relabeled)", () => {
    const { clusters, singletons } = clusterPlays([mkPlay({ skillId: "convergence" }), mkPlay({ skillId: "marketing" })])
    expect(clusters).toHaveLength(0)
    expect(singletons).toHaveLength(2)
  })
})

describe("fuseNearDuplicates", () => {
  it("fast path: no clusters → returns plays unchanged and makes NO model call", async () => {
    const transport = vi.fn<Transport>()
    const plays = [mkPlay({ skillId: "a", evidenceRefs: ["events.x"] }), mkPlay({ skillId: "b", evidenceRefs: ["menu.y"] })]
    const out = await fuseNearDuplicates(plays, competitiveWeekDossier, { transport, scoreOf })
    expect(out).toEqual(plays)
    expect(transport).not.toHaveBeenCalled()
  })

  it("fuses a cross-lens cluster into ONE play citing the union of evidence + strongest confidence", async () => {
    const transport: Transport = async () => ({
      play: {
        title: "Fused move",
        rationale: "Combines both lenses",
        kind: "capitalize",
        ownerRole: "marketing",
        confidence: "directional", // should be overridden to the cluster's strongest (high)
        recipe: [{ channel: "sidewalk", platforms: [], audience: "neighbors", window: { note: "this week" } }],
        leverage: { label: "low", basisInternal: "x" },
        evidenceRefs: ["social.behind_scenes_opportunity"],
      },
    })
    const cluster = [
      mkPlay({ skillId: "marketing", confidence: "high", evidenceRefs: ["social.behind_scenes_opportunity", "social.x"] }),
      mkPlay({ skillId: "guerrilla-marketing", confidence: "medium", evidenceRefs: ["social.behind_scenes_opportunity", "traffic.y"] }),
    ]
    const out = await fuseNearDuplicates(cluster, competitiveWeekDossier, { transport, scoreOf })
    expect(out).toHaveLength(1)
    expect(out[0].knowledgeVersion).toBe("fusion@v1")
    expect(out[0].confidence).toBe("high") // strongest in the cluster
    expect([...out[0].evidenceRefs].sort()).toEqual(["social.behind_scenes_opportunity", "social.x", "traffic.y"])
  })

  it("keeps both when the model says they're genuinely distinct", async () => {
    const transport: Transport = async () => ({ keepSeparate: true })
    const cluster = [mkPlay({ skillId: "marketing" }), mkPlay({ skillId: "guerrilla-marketing" })]
    const out = await fuseNearDuplicates(cluster, competitiveWeekDossier, { transport, scoreOf })
    expect(out).toHaveLength(2)
  })

  it("falls back to keep-best (with union refs) when the model call fails", async () => {
    const transport: Transport = async () => {
      throw new Error("model down")
    }
    const cluster = [
      mkPlay({ skillId: "marketing", confidence: "high", title: "winner", evidenceRefs: ["social.behind_scenes_opportunity", "social.x"] }),
      mkPlay({ skillId: "guerrilla-marketing", confidence: "medium", title: "loser", evidenceRefs: ["social.behind_scenes_opportunity"] }),
    ]
    const out = await fuseNearDuplicates(cluster, competitiveWeekDossier, { transport, scoreOf })
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("winner") // highest scoreOf (high confidence) wins
    expect([...out[0].evidenceRefs].sort()).toEqual(["social.behind_scenes_opportunity", "social.x"])
  })

  it("rejects a fused play that invents a number → falls back to keep-best", async () => {
    const transport: Transport = async () => ({
      play: {
        title: "Save $500 tonight only", // a figure no input play contained
        rationale: "merged",
        kind: "capitalize",
        ownerRole: "marketing",
        confidence: "high",
        recipe: [{ channel: "x", platforms: [], audience: "y", window: { note: "this week" } }],
        leverage: { label: "high", basisInternal: "b" },
        evidenceRefs: ["social.behind_scenes_opportunity"],
      },
    })
    const cluster = [
      mkPlay({ skillId: "marketing", confidence: "high", title: "winner" }),
      mkPlay({ skillId: "guerrilla-marketing", confidence: "medium", title: "loser" }),
    ]
    const out = await fuseNearDuplicates(cluster, competitiveWeekDossier, { transport, scoreOf })
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("winner") // fabricated number rejected -> keep-best (the kept input)
    expect(out[0].knowledgeVersion).not.toBe("fusion@v1")
  })

  it("preserves ordering: a fused cluster slots where its first play appeared", async () => {
    const transport: Transport = async () => ({ keepSeparate: true })
    const sA = mkPlay({ skillId: "demand", evidenceRefs: ["events.a"], title: "A" })
    const c1 = mkPlay({ skillId: "marketing", title: "C1" })
    const sB = mkPlay({ skillId: "ops", evidenceRefs: ["traffic.b"], title: "B" })
    const c2 = mkPlay({ skillId: "guerrilla-marketing", title: "C2" })
    const out = await fuseNearDuplicates([sA, c1, sB, c2], competitiveWeekDossier, { transport, scoreOf })
    // keepSeparate → cluster stays as both, slotted at c1's position: [A, C1, C2, B]
    expect(out.map((p) => p.title)).toEqual(["A", "C1", "C2", "B"])
  })
})
