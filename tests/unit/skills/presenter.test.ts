// P11 — presenter + calibration. Covers the presentation pass (relational framing, real-evidence
// resolution with byte-match grounding, drop-unpaired-stat, strip internal numerics), the synthesis
// WRITE step, the maintain-impact calibration in scoring, and the 3 new eval gates.

import { describe, it, expect, vi } from "vitest"
import {
  toRelative,
  resolveEvidence,
  presentPlay,
  presentBrief,
} from "@/lib/skills/presenter"
import { synthesisWrite, isMultiSignal } from "@/lib/skills/synthesis-write"
import {
  computeBaseScore,
  calibratedImpact,
  hasFailureSignal,
  IMPACT_SCORE,
  MAINTAIN_IMPACT_CAP,
} from "@/lib/skills/scoring-config"
import {
  checkNoRawInternalScore,
  checkCountsHaveDenominator,
  checkMaintainImpactCalibration,
  checkEvidenceGrounded,
  collectStoredQuotes,
} from "@/lib/eval/checks"
import type { BusyTimesResult } from "@/lib/providers/outscraper"
import type { Brief, EnrichedRecommendation, Evidence } from "@/lib/skills/types"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { Transport } from "@/lib/ai/provider"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"

const mkPlay = (over: Partial<EnrichedRecommendation> = {}): EnrichedRecommendation => ({
  title: "t",
  rationale: "r",
  skillId: "marketing",
  ownerRole: "marketing",
  kind: "capitalize",
  recipe: [{ channel: "c", platforms: [], audience: "a", window: { note: "this week" } }],
  confidence: "medium",
  leverage: { label: "medium", basisInternal: "internal math: $400-900/wk" },
  evidenceRefs: ["social.behind_scenes_opportunity"],
  knowledgeVersion: "x@v1",
  ...over,
})

const busy: BusyTimesResult = {
  competitor_id: "self",
  typical_time_spent: null,
  current_popularity: null,
  days: [
    { day_of_week: 5, day_name: "Friday", hourly_scores: [], peak_hour: 19, peak_score: 100, slow_hours: [] },
    { day_of_week: 6, day_name: "Saturday", hourly_scores: [], peak_hour: 19, peak_score: 88, slow_hours: [] },
    { day_of_week: 2, day_name: "Tuesday", hourly_scores: [], peak_hour: 19, peak_score: 40, slow_hours: [] },
  ],
}

describe("toRelative (A1: relational framing, never the raw index)", () => {
  it("frames a quieter day as a % below the week's peak day", () => {
    const r = toRelative(busy, "Saturday")
    expect(r).not.toBeNull()
    expect(r!.peakDay).toBe("Friday")
    expect(r!.pctOfPeak).toBe(88)
    expect(r!.stat).toBe("Saturday runs about 12% below your Friday peak")
    // never the raw peak_score
    expect(r!.stat).not.toMatch(/100|88/)
  })
  it("labels the peak day itself relationally, not with a score", () => {
    expect(toRelative(busy, "Friday")!.stat).toBe("Friday is your busiest day of the week")
  })
  it("returns null when there's no busy-times signal (surfaces nothing, never fabricates)", () => {
    expect(toRelative(null, "Friday")).toBeNull()
    expect(toRelative({ ...busy, days: [] }, "Friday")).toBeNull()
    expect(toRelative(busy, "Nonesuch")).toBeNull()
  })
})

describe("resolveEvidence (A2: real artifact, byte-match grounded)", () => {
  const artifacts = new Map<string, Evidence[]>([
    ["review.theme", [{ quote: "Service was painfully slow on Friday", source: "review.theme" }]],
  ])
  const allowed = new Set(["review.theme", "review.theme:examples"])

  it("attaches the verbatim quote for a cited, grounded ref", () => {
    const out = resolveEvidence(mkPlay({ evidenceRefs: ["review.theme:examples"] }), artifacts, allowed)
    expect(out).toHaveLength(1)
    expect(out[0].quote).toBe("Service was painfully slow on Friday")
  })
  it("does NOT attach evidence for a ref the play doesn't cite", () => {
    const out = resolveEvidence(mkPlay({ evidenceRefs: ["menu.x"] }), artifacts, allowed)
    expect(out).toHaveLength(0)
  })
  it("does NOT attach evidence for a ref outside the grounded index", () => {
    const out = resolveEvidence(mkPlay({ evidenceRefs: ["review.theme"] }), artifacts, new Set<string>())
    expect(out).toHaveLength(0)
  })
})

describe("presentPlay (A: resolve + drop unpaired stat + strip internal numerics)", () => {
  it("strips combinedScore and the leverage basisInternal from the served play", () => {
    const out = presentPlay(mkPlay({ combinedScore: 87 }), new Map(), new Set())
    expect(out.combinedScore).toBeUndefined()
    expect(out.leverage?.basisInternal).toBe("")
    expect(out.leverage?.label).toBe("medium") // the ordinal label survives
  })
  it("drops a relativeStat that has no paired operational consequence", () => {
    const withStat = mkPlay({
      evidence: [
        { source: "x.busy_times", relativeStat: "12% below your Friday peak" }, // no soWhat -> dropped
        { source: "x.busy_times", relativeStat: "12% below your Friday peak", soWhat: "so cut one closer" },
      ],
    })
    const out = presentPlay(withStat, new Map(), new Set())
    expect(out.evidence).toHaveLength(1)
    expect(out.evidence![0].soWhat).toBe("so cut one closer")
  })
})

describe("presentBrief — fail-soft + idempotent", () => {
  it("never throws; returns the brief even if dossier shape is unexpected", () => {
    const brief: Brief = {
      locationId: "l", dateKey: "2026-06-09", headline: "h", deck: "d",
      plays: [mkPlay()], asOf: "2026-06-09T00:00:00Z",
    }
    const out = presentBrief(brief, { ruleOutputs: [] } as unknown as Dossier)
    expect(out.plays).toHaveLength(1)
    expect(out.plays[0].combinedScore).toBeUndefined()
  })

  it("A1b: a traffic play gets a relativeStat + soWhat end-to-end (toRelative is wired in)", () => {
    // dossier: a traffic insight names the quiet day (Saturday); own busy-times prove it runs below
    // the Friday peak. presentBrief must attach the relational framing PAIRED with a so-what.
    const dossier = {
      location: { busyTimes: busy },
      ruleOutputs: [
        {
          insight_type: "traffic.new_slow_period",
          title: "Saturdays running slower",
          summary: "New slow periods on Saturdays.",
          confidence: "medium",
          severity: "info",
          evidence: { day: "Saturday", new_slow_hours: [14, 15] },
          recommendations: [],
        },
      ],
    } as unknown as Dossier

    const play = mkPlay({
      evidenceRefs: ["traffic.new_slow_period"],
      recipe: [{ channel: "in-store", platforms: [], audience: "lunch crowd", window: { note: "Saturday afternoon" } }],
    })
    const brief: Brief = {
      locationId: "l", dateKey: "2026-06-09", headline: "h", deck: "d",
      plays: [play], asOf: "2026-06-09T00:00:00Z",
    }
    const out = presentBrief(brief, dossier)
    const rel = out.plays[0].evidence?.find((e) => e.relativeStat)
    expect(rel).toBeDefined()
    expect(rel!.relativeStat).toBe("Saturday runs about 12% below your Friday peak")
    expect(rel!.soWhat?.trim()).toBeTruthy() // paired so it survives keepPairedStats
    // never the raw busy-times index
    expect(rel!.relativeStat).not.toMatch(/\b100\b|\b88\b/)
  })

  it("A1b: no busy-times signal → no relativeStat fabricated", () => {
    const dossier = {
      location: { busyTimes: null },
      ruleOutputs: [
        { insight_type: "traffic.new_slow_period", title: "t", summary: "s", confidence: "medium", severity: "info", evidence: { day: "Saturday" }, recommendations: [] },
      ],
    } as unknown as Dossier
    const brief: Brief = {
      locationId: "l", dateKey: "2026-06-09", headline: "h", deck: "d",
      plays: [mkPlay({ evidenceRefs: ["traffic.new_slow_period"] })], asOf: "2026-06-09T00:00:00Z",
    }
    const out = presentBrief(brief, dossier)
    expect((out.plays[0].evidence ?? []).some((e) => e.relativeStat)).toBe(false)
  })
})

describe("synthesis WRITE step (B)", () => {
  it("isMultiSignal: only fused (stableKey) or ≥2 distinct refs", () => {
    expect(isMultiSignal(mkPlay({ evidenceRefs: ["a.x"] }))).toBe(false)
    expect(isMultiSignal(mkPlay({ evidenceRefs: ["a.x", "b.y"] }))).toBe(true)
    expect(isMultiSignal(mkPlay({ evidenceRefs: ["a.x"], stableKey: "fused:capitalize|a.x" }))).toBe(true)
  })
  it("leaves single-signal plays untouched and makes NO model call", async () => {
    const transport = vi.fn<Transport>()
    const plays = [mkPlay({ evidenceRefs: ["a.x"] })]
    const out = await synthesisWrite(plays, competitiveWeekDossier, transport)
    expect(out).toEqual(plays)
    expect(transport).not.toHaveBeenCalled()
  })
  it("rewrites a multi-signal play's title+rationale via the model", async () => {
    const transport: Transport = async () => ({ title: "One coherent move", rationale: "Tied together." })
    const [out] = await synthesisWrite([mkPlay({ evidenceRefs: ["a.x", "b.y"] })], competitiveWeekDossier, transport)
    expect(out.title).toBe("One coherent move")
    expect(out.rationale).toBe("Tied together.")
  })
  it("keep-original fallback when the rewrite invents a number not in the input", async () => {
    const transport: Transport = async () => ({ title: "Boost sales 40%", rationale: "Up 40%." })
    const input = mkPlay({ title: "orig", rationale: "orig why", evidenceRefs: ["a.x", "b.y"] })
    const [out] = await synthesisWrite([input], competitiveWeekDossier, transport)
    expect(out.title).toBe("orig") // fabricated 40 -> rejected -> original kept
  })
  it("keep-original on model failure", async () => {
    const transport: Transport = async () => { throw new Error("offline") }
    const input = mkPlay({ title: "orig", evidenceRefs: ["a.x", "b.y"] })
    const [out] = await synthesisWrite([input], competitiveWeekDossier, transport)
    expect(out.title).toBe("orig")
  })
})

describe("C: maintain-impact calibration in scoring", () => {
  it("caps a maintain play with no failure signal at low impact", () => {
    expect(calibratedImpact({ confidence: "high", impact: "high", category: "reputation", stance: "maintain" }))
      .toBe(MAINTAIN_IMPACT_CAP)
  })
  it("lifts the cap when a failure signal is present", () => {
    expect(
      calibratedImpact({
        confidence: "high", impact: "high", category: "reputation",
        stance: "maintain", hasFailureSignal: true,
      }),
    ).toBe("high")
  })
  it("leaves capture/fix plays uncapped", () => {
    expect(calibratedImpact({ confidence: "high", impact: "high", category: "demand", stance: "capture" })).toBe("high")
    expect(calibratedImpact({ confidence: "high", impact: "high", category: "demand" })).toBe("high") // unset -> capture
  })
  it("a maintain best-practice scores BELOW a real problem (cap bites the base)", () => {
    const maintainNovel = computeBaseScore({ confidence: "high", impact: "high", category: "reputation", stance: "maintain" })
    const realProblem = computeBaseScore({ confidence: "high", impact: "high", category: "reputation", stance: "fix" })
    expect(maintainNovel).toBeLessThan(realProblem)
    // it scores as if low-impact
    expect(maintainNovel).toBe(computeBaseScore({ confidence: "high", impact: "low", category: "reputation" }))
  })
  it("hasFailureSignal matches negative/complaint/encroachment ref bases", () => {
    expect(hasFailureSignal(["review.theme:negative_sentiment"])).toBe(true)
    expect(hasFailureSignal(["SEO_COMPETITOR_GROWTH_TREND:PCT"])).toBe(true)
    expect(hasFailureSignal(["social.behind_scenes_opportunity"])).toBe(false)
  })
})

describe("eval gates (the 3 P11 deterministic checks)", () => {
  it("gate 1: flags a customer-facing raw internal score", () => {
    expect(checkNoRawInternalScore(mkPlay({ rationale: "Your peak score of 100 says go." }), 0)).toHaveLength(1)
    expect(checkNoRawInternalScore(mkPlay({ rationale: "Friday runs 12% below your peak." }), 0)).toHaveLength(0)
    // basisInternal existing is NOT a violation (never customer-facing)
    expect(checkNoRawInternalScore(mkPlay(), 0)).toHaveLength(0)
  })
  it("gate 2: flags a bare count with no denominator; passes a rate", () => {
    expect(checkCountsHaveDenominator(mkPlay({ rationale: "2 reviews cite slow service." }), 0)).toHaveLength(1)
    expect(checkCountsHaveDenominator(mkPlay({ rationale: "3 of your last 20 reviews cite slow service." }), 0)).toHaveLength(0)
    const withRate = mkPlay({
      rationale: "2 reviews cite slow service.",
      evidence: [{ source: "review.theme", rate: { numerator: 2, denominator: 20, pct: 10 } }],
    })
    expect(checkCountsHaveDenominator(withRate, 0)).toHaveLength(0)
    // a price/date is not a count -> no false positive
    expect(checkCountsHaveDenominator(mkPlay({ rationale: "Run a $35 prix-fixe." }), 0)).toHaveLength(0)
  })
  it("gate 3: a maintain high-impact play must carry a failure-signal ref", () => {
    const bad = mkPlay({ stance: "maintain", leverage: { label: "high", basisInternal: "" }, evidenceRefs: ["review.theme"] })
    expect(checkMaintainImpactCalibration(bad, 0)).toHaveLength(1)
    const ok = mkPlay({ stance: "maintain", leverage: { label: "high", basisInternal: "" }, evidenceRefs: ["review.theme:negative"] })
    expect(checkMaintainImpactCalibration(ok, 0)).toHaveLength(0)
    // a maintain LOW play is fine without a failure signal
    const low = mkPlay({ stance: "maintain", leverage: { label: "low", basisInternal: "" }, evidenceRefs: ["review.theme"] })
    expect(checkMaintainImpactCalibration(low, 0)).toHaveLength(0)
  })
  it("evidence grounding: rejects a quote that is not byte-verbatim or an ungrounded source", () => {
    const stored = collectStoredQuotes([{ evidence: { examples: ["Service was painfully slow"] } }])
    const index = { allowedRefs: new Set(["review.theme"]), evidenceNumbers: new Set<number>() }
    const verbatim = mkPlay({ evidence: [{ source: "review.theme", quote: "Service was painfully slow" }] })
    expect(checkEvidenceGrounded(verbatim, 0, index, stored)).toHaveLength(0)
    const paraphrase = mkPlay({ evidence: [{ source: "review.theme", quote: "Service was kinda slow" }] })
    expect(checkEvidenceGrounded(paraphrase, 0, index, stored).some((v) => v.code === "evidence_quote_not_verbatim")).toBe(true)
    const ungrounded = mkPlay({ evidence: [{ source: "made.up", quote: "Service was painfully slow" }] })
    expect(checkEvidenceGrounded(ungrounded, 0, index, stored).some((v) => v.code === "evidence_ungrounded_source")).toBe(true)
  })
})

describe("presentPlay — P11 fixes: idempotent re-present + unconditional unpaired-stat drop", () => {
  it("does NOT duplicate a quote when re-presenting a play that already carries it (saved / P7b-resurfaced play)", () => {
    const artifacts = new Map<string, Evidence[]>([
      ["review.theme", [{ quote: "Service was painfully slow on Friday", source: "review.theme" }]],
    ])
    const allowed = new Set(["review.theme"])
    // a play that ALREADY carries the resolved quote (as a saved/resurfaced play would) — re-presenting
    // re-resolves the same quote, but the dedupe keeps exactly one.
    const already = mkPlay({
      evidenceRefs: ["review.theme"],
      evidence: [{ quote: "Service was painfully slow on Friday", source: "review.theme" }],
    })
    const out = presentPlay(already, artifacts, allowed)
    expect(out.evidence).toHaveLength(1)
    expect(out.evidence![0].quote).toBe("Service was painfully slow on Friday")
  })

  it("omits evidence entirely when the only entry is an unpaired relativeStat (drop is unconditional)", () => {
    // no soWhat → dropped; and the stale play.evidence must NOT ride along on the stripped copy.
    const out = presentPlay(
      mkPlay({ evidence: [{ source: "x.busy_times", relativeStat: "12% below your Friday peak" }] }),
      new Map(),
      new Set(),
    )
    expect(out.evidence).toBeUndefined()
  })
})

describe("resolveEvidence — theme-keyed quotes prefer the finer ref (no cross-theme leakage)", () => {
  it("attaches the cited theme's own quote, not another theme's", () => {
    const artifacts = new Map<string, Evidence[]>([
      // base key holds BOTH themes' quotes (back-compat for plays citing the bare ref)
      ["review.theme", [
        { quote: "Service was painfully slow", source: "review.theme" },
        { quote: "The brisket is incredible", source: "review.theme" },
      ]],
      // finer keys hold each theme's own quote
      ["review.theme:slow-service", [{ quote: "Service was painfully slow", source: "review.theme:slow-service" }]],
      ["review.theme:great-food", [{ quote: "The brisket is incredible", source: "review.theme:great-food" }]],
    ])
    const allowed = new Set(["review.theme", "review.theme:slow-service", "review.theme:great-food"])
    const out = resolveEvidence(mkPlay({ evidenceRefs: ["review.theme:slow-service"] }), artifacts, allowed)
    expect(out).toHaveLength(1)
    expect(out[0].quote).toBe("Service was painfully slow") // the cited theme's quote, not the food one
  })
})
