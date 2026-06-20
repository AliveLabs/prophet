// P5 — the cross-domain convergence skill. It runs on the deep pass and must only emit a
// play when >=3 distinct signal domains are present (real cross-domain material).

import { describe, it, expect } from "vitest"
import { convergenceSkill, interleaveByDomain } from "@/lib/skills/convergence/skill"
import { distinctDomains } from "@/lib/skills/evidence-format"
import { CATEGORY_PRIORS } from "@/lib/skills/scoring-config"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"

const sig = (insight_type: string, title: string): GeneratedInsight => ({
  insight_type,
  title,
  summary: "",
  confidence: "medium",
  severity: "info",
  evidence: {},
  recommendations: [],
})
const withSignals = (sigs: GeneratedInsight[]): Dossier => ({ ...competitiveWeekDossier, ruleOutputs: sigs })

describe("convergence skill — wiring", () => {
  it("declares the deep pass + the convergence category", () => {
    expect(convergenceSkill.id).toBe("convergence")
    expect(convergenceSkill.deep).toBe(true)
    expect(convergenceSkill.category).toBe("convergence")
  })
  it("convergence has a neutral scoring prior (earns the bias from evidence)", () => {
    expect(CATEGORY_PRIORS.convergence).toBe(1.0)
  })
})

describe("convergence skill — deterministic fallback", () => {
  it("emits ONE cross-domain play citing >=3 distinct domains", () => {
    const d = withSignals([
      sig("events.game_nearby", "A game lands Friday"),
      sig("menu.heavy_items", "Your menu skews slow-cooked"),
      sig("rating.slow_when_busy", "Reviews mention slow service when busy"),
    ])
    const plays = convergenceSkill.fallback(d)
    expect(plays).toHaveLength(1)
    expect(plays[0].evidenceRefs).toHaveLength(3)
    expect(distinctDomains(plays[0].evidenceRefs).length).toBeGreaterThanOrEqual(3)
    expect(plays[0].skillId).toBe("convergence")
    expect(plays[0].kind).toBe("capitalize")
  })
  it("emits NOTHING when fewer than 3 distinct domains are present", () => {
    expect(convergenceSkill.fallback(withSignals([sig("events.a", "A"), sig("events.b", "B")]))).toEqual([])
    expect(convergenceSkill.fallback(withSignals([]))).toEqual([])
  })
})

describe("convergence skill — selectInput interleaving (finding C)", () => {
  it("represents every domain within the cap instead of dropping late ones", () => {
    // 3 domains × 20 signals each = 60; cap is 40. A flat slice(0,40) would keep only the
    // first two domains and silently drop the third — exactly the cross-domain material lost.
    const make = (dom: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ insight_type: `${dom}.x${i}`, title: "" }))
    const items = [...make("events", 20), ...make("seo", 20), ...make("reviews", 20)]
    const out = interleaveByDomain(items, 40)
    expect(out).toHaveLength(40)
    const domains = new Set(out.map((o) => o.insight_type.split(".")[0]))
    expect(domains).toEqual(new Set(["events", "seo", "reviews"]))
  })
  it("returns all items when under the cap", () => {
    const items = [{ insight_type: "events.a" }, { insight_type: "menu.b" }]
    expect(interleaveByDomain(items, 40)).toHaveLength(2)
  })
})

describe("convergence skill — parse enforces real cross-domain (finding D)", () => {
  const rawPlay = (evidenceRefs: string[]) => ({
    title: "Cross-domain move",
    rationale: "r",
    recipe: [{ channel: "your floor", audience: "guests" }],
    confidence: "medium",
    leverage: { label: "medium", basisInternal: "b" },
    evidenceRefs,
  })

  it("keeps a play that cites >=3 distinct domains", () => {
    const plays = convergenceSkill.parse([rawPlay(["events.game", "menu.heavy", "rating.slow"])], competitiveWeekDossier)
    expect(plays).toHaveLength(1)
    expect(distinctDomains(plays![0].evidenceRefs).length).toBeGreaterThanOrEqual(3)
  })
  it("drops a play that cites 3 refs from ONE domain (not genuinely cross-domain)", () => {
    const plays = convergenceSkill.parse([rawPlay(["events.a", "events.b", "events.c"])], competitiveWeekDossier)
    expect(plays).toEqual([])
  })
  it("returns null on unparseable model output so the deterministic fallback runs", () => {
    expect(convergenceSkill.parse("not json at all", competitiveWeekDossier)).toBeNull()
  })
})
