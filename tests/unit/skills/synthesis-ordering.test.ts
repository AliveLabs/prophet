// ALT-167 (ORDERING half) — the post-selection ordering guard. The served brief order is NOT the pure
// score: the deterministic rankPlays output is only a "merit prior" handed to the Opus selector, which
// may reorder freely, and applyGrassrootsFloor then appends a play. enforceOrderingGuard is the pure,
// deterministic pass applied LAST (after the model order AND the grassroots floor) that guarantees two
// rules on the SERVED order:
//   1. A directional (lowest-confidence) play must NEVER rank #1.
//   2. A high-confidence / low-impact play must NOT outrank a high-impact play.
// Tiers reuse the scoring core: "directional" is the confidence tier; high/low impact is the CALIBRATED
// impact (calibratedImpact, so the P11 maintain cap is respected). The reorder is minimal + stable —
// wherever the rules already hold, the model's order is preserved.

import { describe, it, expect } from "vitest"
import { synthesize, enforceOrderingGuard } from "@/lib/skills/synthesis"
import type { SkillResult } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation, Confidence } from "@/lib/skills/types"
import type { Transport } from "@/lib/ai/provider"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"

type ImpactLabel = "high" | "medium" | "low"

/** A fully-valid play with just the fields the guard reads (confidence + leverage.label) varied.
 *  Capture stance + a non-failure evidence ref → calibratedImpact returns the declared impact. */
const mkPlay = (
  title: string,
  confidence: Confidence,
  impact: ImpactLabel,
  over: Partial<EnrichedRecommendation> = {},
): EnrichedRecommendation => ({
  title,
  rationale: "r",
  skillId: "marketing",
  ownerRole: "marketing",
  kind: "capitalize",
  recipe: [{ channel: "c", platforms: [], audience: "a", window: { note: "this week" } }],
  confidence,
  leverage: { label: impact, basisInternal: "b" },
  evidenceRefs: ["events.weekend_density_spike"],
  knowledgeVersion: "marketing@v1",
  ...over,
})

const scoreMap = (entries: Array<[EnrichedRecommendation, number]>) =>
  new Map<EnrichedRecommendation, number>(entries)

const titles = (plays: EnrichedRecommendation[]) => plays.map((p) => p.title)

describe("enforceOrderingGuard — rule 1: no directional play at #1", () => {
  it("promotes the highest-merit non-directional play when #1 is directional", () => {
    const D = mkPlay("D", "directional", "medium")
    const H = mkPlay("H", "high", "high")
    const M = mkPlay("M", "medium", "medium")
    const scores = scoreMap([[H, 90], [M, 60], [D, 40]])
    const out = enforceOrderingGuard([D, H, M], scores)
    expect(out[0].confidence).not.toBe("directional")
    expect(titles(out)).toEqual(["H", "D", "M"]) // D stays on the brief, just not at #1
  })

  it("picks the highest-merit non-directional play, not merely whatever sits at #2", () => {
    const D = mkPlay("D", "directional", "high")
    const lowMerit = mkPlay("low", "medium", "medium")
    const hiMerit = mkPlay("hi", "high", "high")
    const scores = scoreMap([[hiMerit, 88], [lowMerit, 50], [D, 45]])
    expect(titles(enforceOrderingGuard([D, lowMerit, hiMerit], scores))).toEqual(["hi", "D", "low"])
  })

  it("leaves the order untouched when #1 is already non-directional", () => {
    const H = mkPlay("H", "high", "high")
    const D = mkPlay("D", "directional", "medium")
    const M = mkPlay("M", "medium", "medium")
    const scores = scoreMap([[H, 90], [M, 60], [D, 40]])
    expect(titles(enforceOrderingGuard([H, D, M], scores))).toEqual(["H", "D", "M"])
  })

  it("is a graceful no-op when EVERY chosen play is directional (nothing to promote)", () => {
    const D1 = mkPlay("D1", "directional", "medium")
    const D2 = mkPlay("D2", "directional", "high")
    const D3 = mkPlay("D3", "directional", "low")
    const scores = scoreMap([[D2, 70], [D1, 50], [D3, 30]])
    expect(titles(enforceOrderingGuard([D1, D2, D3], scores))).toEqual(["D1", "D2", "D3"])
  })
})

describe("enforceOrderingGuard — rule 2: high-conf/low-impact must not outrank high-impact", () => {
  it("moves a high-confidence low-impact play below a high-impact play", () => {
    const L = mkPlay("L", "high", "low")
    const HI = mkPlay("HI", "medium", "high")
    const scores = scoreMap([[HI, 70], [L, 65]])
    expect(titles(enforceOrderingGuard([L, HI], scores))).toEqual(["HI", "L"])
  })

  it("reorders only the constrained plays, leaving unconstrained (medium) plays in place", () => {
    const L = mkPlay("L", "high", "low") // constrained: high-conf low-impact
    const X = mkPlay("X", "medium", "medium") // unconstrained
    const HI = mkPlay("HI", "medium", "high") // constrained: high-impact
    const scores = scoreMap([[HI, 70], [X, 60], [L, 65]])
    expect(titles(enforceOrderingGuard([L, X, HI], scores))).toEqual(["HI", "X", "L"])
  })

  it("leaves an already-compliant order unchanged (minimal reorder)", () => {
    const HI = mkPlay("HI", "medium", "high")
    const X = mkPlay("X", "medium", "medium")
    const L = mkPlay("L", "high", "low")
    const scores = scoreMap([[HI, 70], [X, 60], [L, 55]])
    expect(titles(enforceOrderingGuard([HI, X, L], scores))).toEqual(["HI", "X", "L"])
  })
})

describe("enforceOrderingGuard — rule interaction", () => {
  it("rule 1 wins when the two rules conflict (a directional high-impact play cannot take #1)", () => {
    // Only two plays: a directional high-impact play and a high-conf low-impact play. Both rules
    // cannot hold at once (rule 2 wants the high-impact one above, rule 1 forbids it at #1). Rule 1
    // is the hard guarantee — the directional play must not lead.
    const L = mkPlay("L", "high", "low")
    const DHI = mkPlay("DHI", "directional", "high")
    const scores = scoreMap([[DHI, 75], [L, 65]])
    const out = enforceOrderingGuard([DHI, L], scores)
    expect(out[0].confidence).not.toBe("directional")
    expect(titles(out)).toEqual(["L", "DHI"])
  })

  it("enforces BOTH rules together: directional #1 demoted AND high-impact lifted over high-conf/low-impact", () => {
    const D = mkPlay("D", "directional", "medium")
    const L = mkPlay("L", "high", "low")
    const HI = mkPlay("HI", "medium", "high")
    const scores = scoreMap([[HI, 80], [L, 70], [D, 40]])
    const out = enforceOrderingGuard([D, L, HI], scores)
    expect(out[0].confidence).not.toBe("directional")
    expect(titles(out)).toEqual(["HI", "D", "L"])
  })
})

describe("synthesize() wires the ordering guard into the served brief", () => {
  // A successful transport that returns the model's selection verbatim. Fusion makes no LLM call here
  // (the two plays share a skill → no cross-skill cluster forms), so this transport only drives selection.
  const selecting = (order: number[]): Transport => async () => ({
    headline: "This week's moves",
    deck: "A solid week with a couple of clear opportunities to capture more guests and steady the operation.",
    order,
  })

  it("never serves a directional play at #1 even when the model orders it first", async () => {
    const directionalFirst = mkPlay("Directional move", "directional", "high", {
      evidenceRefs: ["events.weekend_density_spike"],
    })
    const strong = mkPlay("Strong move", "high", "high", { evidenceRefs: ["traffic.new_slow_period"] })
    const results: SkillResult[] = [{ skillId: "marketing", status: "ok", plays: [directionalFirst, strong] }]

    const brief = await synthesize(competitiveWeekDossier, results, { transport: selecting([0, 1]), maxPlays: 2 })

    expect(brief.plays).toHaveLength(2) // both kept — the guard reorders, it does not drop
    expect(brief.plays[0].confidence).not.toBe("directional")
    expect(brief.plays[0].title).toBe("Strong move")
  })
})
