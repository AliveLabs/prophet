// P6 — the guerrilla / grassroots marketing skill. Category "marketing" (reuses the neutral
// 1.0 prior), standard reasoning tier. Owns the OFFLINE, zero-budget, hyper-local craft;
// grounds plays on events.* / traffic.* / community-social rule outputs.

import { describe, it, expect } from "vitest"
import { guerrillaMarketingSkill } from "@/lib/skills/guerrilla-marketing/skill"
import { runProducerSkill } from "@/lib/skills/run"
import { CATEGORY_PRIORS } from "@/lib/skills/scoring-config"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { Transport } from "@/lib/ai/provider"

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

describe("guerrilla-marketing skill — wiring", () => {
  it("declares its own grassroots category on the standard reasoning tier (not the deep pass)", () => {
    expect(guerrillaMarketingSkill.id).toBe("guerrilla-marketing")
    expect(guerrillaMarketingSkill.category).toBe("grassroots")
    expect(guerrillaMarketingSkill.ownerRole).toBe("marketing")
    expect(guerrillaMarketingSkill.deep).toBeFalsy()
    expect(guerrillaMarketingSkill.tier).toBe("reasoning")
  })
  it("grassroots is its own category, split from marketing, with a neutral prior", () => {
    expect(CATEGORY_PRIORS.grassroots).toBe(1.0)
    expect(guerrillaMarketingSkill.category).not.toBe("marketing")
  })
})

describe("guerrilla-marketing skill — deterministic fallback", () => {
  it("grounds a zero-budget move on a local event signal", () => {
    const plays = guerrillaMarketingSkill.fallback(withSignals([sig("events.new_high_signal_event", "Street festival two blocks away Saturday")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].skillId).toBe("guerrilla-marketing")
    expect(plays[0].ownerRole).toBe("marketing")
    expect(plays[0].kind).toBe("capitalize")
    expect(plays[0].evidenceRefs).toEqual(["events.new_high_signal_event"])
  })
  it("grounds on a traffic signal (a dead window to fill)", () => {
    const plays = guerrillaMarketingSkill.fallback(withSignals([sig("traffic.new_slow_period", "Tuesday afternoons went quiet")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].evidenceRefs).toEqual(["traffic.new_slow_period"])
  })
  it("grounds on a community-social signal", () => {
    const plays = guerrillaMarketingSkill.fallback(withSignals([sig("social.crowd_perception_gap", "Locals do not realize how busy you get")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].evidenceRefs).toEqual(["social.crowd_perception_gap"])
  })
  it("emits NOTHING when no event/traffic/community signal is present", () => {
    expect(
      guerrillaMarketingSkill.fallback(withSignals([sig("menu.signature_item_missing", "No signature"), sig("seo_keyword_win", "Won a keyword")])),
    ).toEqual([])
    expect(guerrillaMarketingSkill.fallback(withSignals([]))).toEqual([])
  })
})

describe("guerrilla-marketing skill — parse (P16: the named-anchor gate)", () => {
  const rawPlay = (evidenceRefs: string[], extra: Record<string, unknown> = {}) => ({
    title: "Set an A-frame at the festival corner Saturday",
    rationale: "A street festival lands two blocks away; intercept the foot traffic with a same-day offer.",
    recipe: [{ channel: "the sidewalk", audience: "festival-goers walking past" }],
    confidence: "directional",
    leverage: { label: "medium", basisInternal: "grassroots interception sized ordinally" },
    evidenceRefs,
    ...extra,
  })
  it("SUPPRESSES a grounded play that names NO partner entity or dated event (the core upgrade)", () => {
    // competitiveWeekDossier has no partnerEntities and no events, so even a play that cites a real
    // grassroots signal must be dropped — it can't name an anchor.
    const plays = guerrillaMarketingSkill.parse([rawPlay(["events.new_high_signal_event"])], competitiveWeekDossier)
    expect(plays).toEqual([])
  })
  it("stamps the upgraded knowledge version", () => {
    expect(guerrillaMarketingSkill.knowledgeVersion).toBe("guerrilla@v2.2")
  })
  it("returns null on unparseable output so the deterministic fallback runs", () => {
    expect(guerrillaMarketingSkill.parse(42, competitiveWeekDossier)).toBeNull()
  })
})

describe("guerrilla-marketing skill — run.ts ground-filter end-to-end (model failure -> fallback)", () => {
  const failing: Transport = async () => {
    throw new Error("model down")
  }
  it("falls back to deterministic plays, all grounded in real rule outputs", async () => {
    const d = withSignals([sig("events.new_high_signal_event", "Festival Saturday")])
    const res = await runProducerSkill(guerrillaMarketingSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays.length).toBeGreaterThan(0)
    const allowed = buildRefIndex(d).allowedRefs
    for (const p of res.plays) expect(p.evidenceRefs.every((r) => allowed.has(r))).toBe(true)
  })
  it("a model failure with ONLY a non-grassroots signal yields zero plays (no signal, no play)", async () => {
    // menu.* is food-pairing's, not guerrilla's — the zero-play invariant must hold end-to-end.
    const d = withSignals([sig("menu.signature_item_missing", "No signature dish")])
    const res = await runProducerSkill(guerrillaMarketingSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toEqual([])
  })
})
