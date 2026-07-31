// ---------------------------------------------------------------------------
// Non-blocking eval recorder (step 3). The deterministic checks in lib/eval/checks.ts previously had
// zero runtime callers, so anti-fabrication was enforced against CI fixtures but never observed on
// real served briefs.
//
// What matters here is the NON-BLOCKING contract, because this runs inside every nightly build:
// it must never throw, never mutate the brief, and must never report a brief as clean when the
// checks did not actually run. The last one is the subtle failure: an absent field that reads as
// "fine" would make the whole signal worthless.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, afterEach } from "vitest"
import { recordBriefEval, logEvalRecord, MAX_RECORDED_VIOLATIONS } from "@/lib/eval/record"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { Brief } from "@/lib/skills/types"
import type { EnrichedRecommendation } from "@/lib/skills/types"

afterEach(() => vi.restoreAllMocks())

/** A dossier with one grounded rule output, so `menu_gap` and `menu_gap:examples` are allowed refs. */
const dossierOf = (over: Partial<Dossier> = {}): Dossier =>
  ({
    locationId: "loc-1",
    dateKey: "2026-07-31",
    generatedAt: "2026-07-31T10:00:00Z",
    profile: { locationId: "loc-1" },
    ruleOutputs: [{ insight_type: "menu_gap", evidence: { examples: ["they serve a $12 smash burger"] } }],
    demandCalendar: { events: [], metroHooks: [], weather: [] },
    ...over,
  }) as unknown as Dossier

/** Mirrors the shape existing passing tests use (recipe is a RecipeStep ARRAY, not an object). */
const playOf = (over: Partial<EnrichedRecommendation> = {}): EnrichedRecommendation =>
  ({
    title: "Add a smash burger at lunch",
    rationale: "The nearby spot sells one and you do not.",
    skillId: "positioning",
    ownerRole: "marketing",
    kind: "capitalize",
    recipe: [{ channel: "in-store", platforms: [], audience: "lunch walk-ins", window: { note: "this week" } }],
    confidence: "medium",
    leverage: { label: "medium", basisInternal: "b" },
    evidenceRefs: ["menu_gap"],
    knowledgeVersion: "positioning@v1",
    ...over,
  }) as unknown as EnrichedRecommendation

const briefOf = (plays: EnrichedRecommendation[]): Brief =>
  ({ headline: "Today", deck: "A short deck.", plays }) as unknown as Brief

describe("non-blocking contract", () => {
  it("returns undefined rather than throwing when the dossier is unusable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // No ruleOutputs at all -> buildRefIndex throws internally.
    const broken = { locationId: "loc-broken" } as unknown as Dossier
    expect(() => recordBriefEval(briefOf([playOf()]), broken)).not.toThrow()
    expect(recordBriefEval(briefOf([playOf()]), broken)).toBeUndefined()
    // Silent-but-loud: absent field, but a log line so a permanently broken recorder is visible.
    expect(warn).toHaveBeenCalled()
  })

  it("absence means NOT EVALUATED, never clean — there is no ok:true fallback on failure", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const rec = recordBriefEval(briefOf([playOf()]), { locationId: "x" } as unknown as Dossier)
    expect(rec).toBeUndefined()
    // Guards against a future "helpful" default of { ok: true } on the error path.
    expect(rec?.ok).not.toBe(true)
  })

  it("does not mutate the brief or its plays", () => {
    const plays = [playOf()]
    const brief = briefOf(plays)
    const snapshot = JSON.stringify(brief)
    recordBriefEval(brief, dossierOf())
    expect(JSON.stringify(brief)).toBe(snapshot)
  })
})

describe("recording", () => {
  it("reports a grounded brief as ok with no violations", () => {
    const rec = recordBriefEval(briefOf([playOf()]), dossierOf())
    expect(rec?.ok).toBe(true)
    expect(rec?.violationCount).toBe(0)
    expect(rec?.byCode).toEqual({})
  })

  it("catches an ungrounded evidence ref on the served brief", () => {
    const rec = recordBriefEval(briefOf([playOf({ evidenceRefs: ["totally_made_up_rule"] })]), dossierOf())
    expect(rec?.ok).toBe(false)
    expect(rec!.violationCount).toBeGreaterThan(0)
    // Tallied per code — the shape worth querying for a trend.
    expect(Object.values(rec!.byCode).reduce((a, b) => a + b, 0)).toBe(rec!.violationCount)
  })

  it("truncates the stored list but keeps the true count honest", () => {
    const many = Array.from({ length: MAX_RECORDED_VIOLATIONS + 10 }, () =>
      playOf({ evidenceRefs: ["nope_not_a_rule"] }),
    )
    const rec = recordBriefEval(briefOf(many), dossierOf())
    expect(rec!.violations.length).toBeLessThanOrEqual(MAX_RECORDED_VIOLATIONS)
    expect(rec!.violationCount).toBeGreaterThan(rec!.violations.length)
    expect(rec!.truncated).toBe(true)
  })

  it("omits the truncated flag when nothing was dropped", () => {
    const rec = recordBriefEval(briefOf([playOf()]), dossierOf())
    expect(rec!.truncated).toBeUndefined()
  })
})

describe("geo sanity wiring", () => {
  it("flags an event-citing play when the dossier has neither local events nor metro hooks", () => {
    const d = dossierOf({
      ruleOutputs: [{ insight_type: "events.today", evidence: {} }],
      demandCalendar: { events: [], metroHooks: [], weather: [] },
    } as unknown as Partial<Dossier>)
    const rec = recordBriefEval(briefOf([playOf({ evidenceRefs: ["events.today"] })]), d)
    expect(rec?.byCode.event_geo_ungrounded).toBeGreaterThanOrEqual(1)
  })

  it("does not flag it when the dossier actually has local events", () => {
    const d = dossierOf({
      ruleOutputs: [{ insight_type: "events.today", evidence: {} }],
      demandCalendar: { events: [{ title: "Street fair" }], metroHooks: [], weather: [] },
    } as unknown as Partial<Dossier>)
    const rec = recordBriefEval(briefOf([playOf({ evidenceRefs: ["events.today"] })]), d)
    expect(rec?.byCode.event_geo_ungrounded).toBeUndefined()
  })
})

describe("logEvalRecord", () => {
  it("stays silent on a clean brief and on an unevaluated one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    logEvalRecord("loc-1", { ok: true, violationCount: 0, byCode: {}, violations: [] })
    logEvalRecord("loc-1", undefined)
    expect(warn).not.toHaveBeenCalled()
  })

  it("logs a per-code summary when the served brief has violations", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    logEvalRecord("loc-1", {
      ok: false,
      violationCount: 3,
      byCode: { ungrounded_ref: 2, voice: 1 },
      violations: [],
    })
    expect(warn).toHaveBeenCalledOnce()
    const msg = String(warn.mock.calls[0][0])
    expect(msg).toContain("loc-1")
    expect(msg).toContain("ungrounded_ref×2")
  })
})
