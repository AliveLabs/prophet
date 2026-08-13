import { describe, it, expect } from "vitest"
import {
  distinctFamiliesOf,
  producerReadiness,
  selectFirstBriefProducers,
} from "@/lib/skills/first-brief-producers"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import type { ProducerSkill, SkillGrounding } from "@/lib/skills/skill-types"
import { extractPreviousBuild } from "@/lib/skills/differential"
import { runBrief } from "@/lib/skills/pipeline"
import { arenaWeekDossier } from "@/tests/fixtures/dossiers/arena-week"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { Transport } from "@/lib/ai/provider"
import type { Brief, EnrichedRecommendation, SkillHealth } from "@/lib/skills/types"

/** A stand-in producer. Only `id` and `grounding` matter to the selector. */
function skill(id: string, grounding?: SkillGrounding): ProducerSkill {
  return { id, grounding } as unknown as ProducerSkill
}

const family = (prefix: string): SkillGrounding => ({
  kind: "family",
  matches: (t) => t.startsWith(prefix),
})

describe("producerReadiness — family grounding", () => {
  it("is READY when at least one rule output is in the skill's own family", () => {
    const r = producerReadiness(family("review."), ["review.theme", "traffic.baseline"])
    expect(r.ready).toBe(true)
    expect(r.matched).toEqual(["review.theme"])
  })

  it("collects every matching ref, not just the first", () => {
    const r = producerReadiness(family("social."), ["social.viral_content", "events.x", "social.hashtag_gap"])
    expect(r.matched).toEqual(["social.viral_content", "social.hashtag_gap"])
  })

  it("is NOT ready when the family is absent, and says which reason", () => {
    const r = producerReadiness(family("menu."), ["review.theme", "traffic.baseline"])
    expect(r.ready).toBe(false)
    if (r.ready) throw new Error("unreachable")
    expect(r.reason).toBe("no_grounding_signal")
    expect(r.detail).toContain("grounding family")
  })

  it("is NOT ready on an empty dossier", () => {
    expect(producerReadiness(family("review."), []).ready).toBe(false)
  })

  it("matches on PREFIX, not equality — the same rule the skills' own predicates use", () => {
    expect(producerReadiness(family("hours"), ["hours.own_slow_window"]).ready).toBe(true)
  })
})

describe("producerReadiness — distinct-families grounding (convergence)", () => {
  const familyOf = (ref: string): string | null => {
    const base = ref.split(":")[0]
    if (base.startsWith("review")) return "reputation"
    if (base.startsWith("traffic.")) return "traffic"
    if (base.startsWith("events.")) return "demand"
    return null // bookkeeping rows never count as a channel
  }
  const grounding: SkillGrounding = { kind: "distinct_families", familyOf, min: 3 }

  it("is READY at exactly the required number of distinct families", () => {
    const r = producerReadiness(grounding, ["review.theme", "traffic.baseline", "events.new_high_signal_event"])
    expect(r.ready).toBe(true)
    expect(r.matched).toEqual(["reputation", "traffic", "demand"])
  })

  it("is NOT ready when many rows collapse into too few families", () => {
    const r = producerReadiness(grounding, ["traffic.baseline", "traffic.competitive_opportunity", "review.theme"])
    expect(r.ready).toBe(false)
    if (r.ready) throw new Error("unreachable")
    expect(r.reason).toBe("insufficient_families")
    expect(r.detail).toContain("2 had landed")
  })

  it("never counts an unfamilied bookkeeping row toward the requirement", () => {
    const r = producerReadiness(grounding, ["review.theme", "traffic.baseline", "baseline_snapshot", "competitive_summary"])
    expect(r.ready).toBe(false)
  })
})

describe("distinctFamiliesOf", () => {
  const familyOf = (r: string) => (r.startsWith("a") ? "A" : r.startsWith("b") ? "B" : null)

  it("dedupes and preserves first-seen order", () => {
    expect(distinctFamiliesOf(["a1", "b1", "a2", "b2"], familyOf)).toEqual(["A", "B"])
  })

  it("drops nulls", () => {
    expect(distinctFamiliesOf(["z1", "a1"], familyOf)).toEqual(["A"])
  })
})

describe("selectFirstBriefProducers", () => {
  const skills = [skill("alpha", family("a.")), skill("beta", family("b.")), skill("gamma", family("g."))]

  it("runs only the producers that can ground, and reports the rest", () => {
    const sel = selectFirstBriefProducers(skills, ["a.one", "g.two"])
    expect(sel.run.map((s) => s.id)).toEqual(["alpha", "gamma"])
    expect(sel.skipped).toEqual([
      { skillId: "beta", reason: "no_grounding_signal", detail: expect.stringContaining("grounding family") },
    ])
  })

  it("preserves registry ORDER for the survivors (convergence is registered last on purpose)", () => {
    const sel = selectFirstBriefProducers(skills, ["a.one", "b.one", "g.one"])
    expect(sel.run.map((s) => s.id)).toEqual(["alpha", "beta", "gamma"])
    expect(sel.skipped).toEqual([])
  })

  it("skips NOTHING when every family has landed — a first brief with full data is a full brief", () => {
    const sel = selectFirstBriefProducers(skills, ["a.1", "b.1", "g.1"])
    expect(sel.run).toHaveLength(3)
    expect(sel.skipped).toHaveLength(0)
  })

  it("NEVER skips a skill that declares no grounding (absence of a declaration means run)", () => {
    const sel = selectFirstBriefProducers([skill("undeclared")], [])
    expect(sel.run.map((s) => s.id)).toEqual(["undeclared"])
    expect(sel.skipped).toEqual([])
  })

  it("SAFETY VALVE: runs the full set rather than none when nothing at all can ground", () => {
    const sel = selectFirstBriefProducers(skills, [])
    expect(sel.run.map((s) => s.id)).toEqual(["alpha", "beta", "gamma"])
    expect(sel.skipped).toEqual([])
  })
})

describe("the real registry", () => {
  it("declares grounding on every producer, so no expert is silently un-gateable", () => {
    const undeclared = PRODUCER_SKILLS.filter((s) => !s.grounding).map((s) => s.id)
    expect(undeclared).toEqual([])
  })

  it("gates convergence on distinct families and every domain expert on its own family", () => {
    for (const s of PRODUCER_SKILLS) {
      expect(s.grounding!.kind).toBe(s.id === "convergence" ? "distinct_families" : "family")
    }
  })

  it("runs the WHOLE registry on a dossier carrying every family (the steady state)", () => {
    const everyFamily = [
      "review.theme",
      "rating_change",
      "review_themes",
      "traffic.baseline",
      "hours.own_slow_window",
      "events.new_high_signal_event",
      "social.viral_content",
      "visual.category_shift",
      "menu.category_gap",
      "content.conversion_feature_gap",
      "photo.new_content",
      "seo_keyword_opportunity_gap",
      "cross_event_seo_opportunity",
    ]
    const sel = selectFirstBriefProducers(PRODUCER_SKILLS, everyFamily)
    expect(sel.skipped).toEqual([])
    expect(sel.run).toHaveLength(PRODUCER_SKILLS.length)
  })

  it("skips positioning and social-counter on a review+traffic-only first dossier", () => {
    // The shape a real day-0 dossier takes when the menu gate is off, no social account is live,
    // and buildDossier has pushed its own review.theme + hours.own_* rows.
    const sel = selectFirstBriefProducers(PRODUCER_SKILLS, [
      "review.theme",
      "review_themes",
      "traffic.baseline",
      "hours.own_slow_window",
    ])
    const skipped = sel.skipped.map((s) => s.skillId).sort()
    expect(skipped).toContain("positioning")
    expect(skipped).toContain("social-counter")
    expect(skipped).toContain("local-demand")
    // …and the ones that CAN ground still run.
    expect(sel.run.map((s) => s.id)).toContain("reputation")
    expect(sel.run.map((s) => s.id)).toContain("operations")
  })
})

// ── The boundary: a location with prior briefs must behave exactly as today ───────────────────

describe("nightly path is untouched", () => {
  it("a skipped health slot can NEVER seed a differential reuse", () => {
    const play = { title: "t", evidenceRefs: ["review.theme"] } as unknown as EnrichedRecommendation
    const health: SkillHealth[] = [
      { skillId: "reputation", status: "ok", usedFallback: false, inputHash: "hash-rep" },
      // A skip that (defensively) carries a hash anyway must still be ignored.
      { skillId: "positioning", status: "ok", usedFallback: false, skipped: true, inputHash: "hash-pos" },
    ]
    const brief = {
      dateKey: "2026-08-12",
      skillHealth: health,
      skillOutputs: { reputation: [play], positioning: [play] },
    } as unknown as Brief

    const previous = extractPreviousBuild(brief, "2026-08-13")
    expect(previous).toBeDefined()
    expect(Object.keys(previous!.hashes)).toEqual(["reputation"])
    expect(previous!.outputs.positioning).toBeUndefined()
  })

  it("a brief whose ONLY slots were skips is not reusable at all", () => {
    const brief = {
      dateKey: "2026-08-12",
      skillHealth: [{ skillId: "positioning", status: "ok", usedFallback: false, skipped: true, inputHash: "h" }],
      skillOutputs: { positioning: [] },
    } as unknown as Brief
    expect(extractPreviousBuild(brief, "2026-08-13")).toBeUndefined()
  })
})

// ── runBrief end to end, over a deliberately thin dossier ────────────────────────────────────

/** The arena-week fixture narrowed to the families a real day-0 dossier carries: own review
 *  themes, own hours, a competitor traffic baseline. No events, no menu, no social. */
const thinDossier: Dossier = {
  ...arenaWeekDossier,
  ruleOutputs: [
    { insight_type: "review.theme.service_speed", title: "Guests mention slow service", summary: "Repeated in recent reviews.", confidence: "high", severity: "warning", evidence: { mentions: 6 }, recommendations: [] },
    { insight_type: "hours.own_slow_window", title: "A slow window on your own curve", summary: "Tuesday mid-afternoon runs quiet.", confidence: "medium", severity: "info", evidence: { day: "Tuesday" }, recommendations: [] },
    { insight_type: "traffic.baseline", title: "Rival traffic captured", summary: "Baseline for future comparison.", confidence: "medium", severity: "info", evidence: { peaks: [] }, recommendations: [] },
  ] as Dossier["ruleOutputs"],
}

/** Records which producers were actually asked for output. Returns junk so every skill lands on
 *  its deterministic floor — the brief's SHAPE is irrelevant here; the call list is the assertion. */
function recordingTransport(): { transport: Transport; labels: string[] } {
  const labels: string[] = []
  const transport: Transport = async (req) => {
    if (req.label) labels.push(req.label)
    return null
  }
  return { transport, labels }
}

describe("runBrief first-brief gating", () => {
  it("calls only the producers that can ground when firstBrief is set", async () => {
    const { transport, labels } = recordingTransport()
    const { brief } = await runBrief(thinDossier, { transport, firstBrief: true })

    expect(labels).toContain("reputation")
    expect(labels).toContain("operations")
    expect(labels).not.toContain("positioning")
    expect(labels).not.toContain("social-counter")
    expect(labels).not.toContain("local-demand")

    // Every registry slot is still ACCOUNTED FOR, skipped or not — a skip is never a hole.
    const health = brief.skillHealth ?? []
    expect(health).toHaveLength(PRODUCER_SKILLS.length)
    const skipped = health.filter((h) => h.skipped)
    expect(skipped.length).toBeGreaterThan(0)
    for (const h of skipped) {
      expect(h.usedFallback).toBe(false) // a skip is not a degradation
      expect(h.status).toBe("ok")
      expect(h.reason).toBeTruthy() // never a bare flag
      expect(h.inputHash).toBeUndefined() // cannot seed tomorrow's reuse
      expect(h.tokens).toBeUndefined() // nothing ran, nothing billed
    }
    expect(brief.providerStats?.producersSkipped).toBe(skipped.length)
  })

  it("A LOCATION WITH PRIOR BRIEFS IS UNCHANGED: firstBrief unset calls every producer", async () => {
    const { transport, labels } = recordingTransport()
    const { brief } = await runBrief(thinDossier, { transport })

    for (const s of PRODUCER_SKILLS) expect(labels).toContain(s.id)
    const health = brief.skillHealth ?? []
    expect(health).toHaveLength(PRODUCER_SKILLS.length)
    expect(health.some((h) => h.skipped)).toBe(false)
    expect(brief.providerStats?.producersSkipped).toBeUndefined()
  })

  it("firstBrief: false is identical to omitting it", async () => {
    const { transport, labels } = recordingTransport()
    await runBrief(thinDossier, { transport, firstBrief: false })
    for (const s of PRODUCER_SKILLS) expect(labels).toContain(s.id)
  })

  it("an explicit `skills` list always wins — a caller naming its set has already decided", async () => {
    const { transport, labels } = recordingTransport()
    const positioning = PRODUCER_SKILLS.find((s) => s.id === "positioning")!
    const { brief } = await runBrief(thinDossier, { transport, firstBrief: true, skills: [positioning] })
    expect(labels).toEqual(["positioning"])
    expect((brief.skillHealth ?? []).some((h) => h.skipped)).toBe(false)
  })

  it("the gate is DATA-driven, not time-driven: a different dossier skips a different set", async () => {
    // arena-week carries events.* + menu.* (and nothing else), so exactly the reverse of the thin
    // dossier's set survives: local-demand and positioning run, reputation and operations do not.
    const { transport, labels } = recordingTransport()
    const { brief } = await runBrief(arenaWeekDossier, { transport, firstBrief: true })
    const skipped = (brief.skillHealth ?? []).filter((h) => h.skipped).map((h) => h.skillId)

    expect(labels).toContain("local-demand")
    expect(labels).toContain("positioning")
    expect(skipped).toContain("reputation")
    expect(skipped).toContain("operations")
    // Convergence needs three distinct families; this fixture carries two (demand + menu).
    expect(skipped).toContain("convergence")
  })

  it("a play the gate removed could not have existed anyway: the surviving plays are identical", async () => {
    // The whole safety argument in one assertion. Same dossier, same transport, gated vs ungated —
    // if a skipped producer could ever have contributed, these two briefs would differ.
    const gated = await runBrief(thinDossier, { transport: recordingTransport().transport, firstBrief: true })
    const full = await runBrief(thinDossier, { transport: recordingTransport().transport })
    expect(gated.brief.plays.map((p) => p.title)).toEqual(full.brief.plays.map((p) => p.title))
  })
})
