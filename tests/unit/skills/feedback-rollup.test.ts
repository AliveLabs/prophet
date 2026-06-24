import { describe, it, expect } from "vitest"
import {
  FEEDBACK_SIGNAL_MAP,
  signalFor,
  actionForVerdict,
  type FeedbackAction,
  type FeedbackSignal,
} from "@/lib/skills/feedback-signals"
import {
  aggregateSignals,
  buildRollupRows,
  loadPlayTypeMultipliers,
  NEUTRAL_LOOKUP,
  GLOBAL_MIN_ORG_SUPPORT_N,
  type MappedFeedback,
} from "@/lib/skills/feedback-rollup"
import {
  computePlayTypeKey,
  severityBand,
  leadEvidenceDomain,
} from "@/lib/skills/preferences"
import {
  computeCombinedScore,
  rankPlays,
  multiplierFromBayesScore,
  calibrationOf,
  PLAY_TYPE_MULTIPLIER_MIN,
  PLAY_TYPE_MULTIPLIER_MAX,
  PLAY_TYPE_MULTIPLIER_NEUTRAL,
  PLAY_TYPE_MIN_SUPPORT_N,
  type ScoreInput,
} from "@/lib/skills/scoring-config"
import { resolveCategoryPriors } from "@/lib/skills/category-priors"
import type { EnrichedRecommendation } from "@/lib/skills/types"

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
function sig(action: FeedbackAction, over: Partial<MappedFeedback> = {}): MappedFeedback {
  return {
    skillId: "food-pairing",
    playTypeKey: "food-pairing|capitalize|menu|tame",
    organizationId: "org-1",
    locationId: "loc-1",
    severity: 0,
    signal: signalFor(action),
    ...over,
  }
}

/** Build N events of one action (optionally split across orgs/locations). */
function many(action: FeedbackAction, n: number, over: Partial<MappedFeedback> = {}): MappedFeedback[] {
  return Array.from({ length: n }, () => sig(action, over))
}

// =================================================================================================
// THE BAND — the single tuning point. Thumbs = high-confidence explicit; save/snooze/dismiss =
// lower-confidence directional. A RETUNE of the map changes weights WITHOUT touching rollup code.
// =================================================================================================
describe("feedback-signals BAND", () => {
  it("maps thumbs as the STRONG explicit primary signal (high confidence, full weight, clear polarity)", () => {
    expect(FEEDBACK_SIGNAL_MAP.thumbs_up).toMatchObject({ polarity: 1 })
    expect(FEEDBACK_SIGNAL_MAP.thumbs_down).toMatchObject({ polarity: -1 })
    expect(FEEDBACK_SIGNAL_MAP.thumbs_up.confidence).toBeGreaterThanOrEqual(0.9)
    expect(FEEDBACK_SIGNAL_MAP.thumbs_down.confidence).toBeGreaterThanOrEqual(0.9)
    expect(FEEDBACK_SIGNAL_MAP.thumbs_up.weight).toBe(1.0)
  })

  it("maps save/snooze/dismiss as LOWER-confidence DIRECTIONAL signals (provisional weights)", () => {
    for (const a of ["saved", "snoozed", "dismissed"] as const) {
      expect(FEEDBACK_SIGNAL_MAP[a].confidence).toBeLessThan(FEEDBACK_SIGNAL_MAP.thumbs_up.confidence)
      expect(FEEDBACK_SIGNAL_MAP[a].weight).toBeLessThanOrEqual(FEEDBACK_SIGNAL_MAP.thumbs_up.weight)
    }
    // directionality: save positive, dismiss/snooze negative; snooze is the weakest read.
    expect(FEEDBACK_SIGNAL_MAP.saved.polarity).toBe(1)
    expect(FEEDBACK_SIGNAL_MAP.dismissed.polarity).toBe(-1)
    expect(FEEDBACK_SIGNAL_MAP.snoozed.polarity).toBe(-1)
    expect(FEEDBACK_SIGNAL_MAP.snoozed.confidence).toBeLessThanOrEqual(FEEDBACK_SIGNAL_MAP.dismissed.confidence)
  })

  it("signalFor degrades an UNKNOWN/legacy action to a true no-op (never throws) — engine isolated", () => {
    expect(signalFor("totally_new_action")).toEqual({ polarity: 0, weight: 0, confidence: 0 })
  })

  it("the EXISTING thumbs verdict (good|bad) routes through the SAME band", () => {
    expect(actionForVerdict("good")).toBe("thumbs_up")
    expect(actionForVerdict("bad")).toBe("thumbs_down")
  })

  it("RETUNE-NOT-REWRITE: a retuned map changes the rollup output with NO change to rollup code", () => {
    // The rollup consumes ONLY the band's {polarity,weight,confidence} via signalFor. Simulate a
    // retune by feeding events built from an ALTERNATE map and confirm aggregateSignals (unchanged
    // code) yields a different multiplier — proving action semantics live solely in the band.
    const events = (mapSel: (a: FeedbackAction) => FeedbackSignal): MappedFeedback[] =>
      Array.from({ length: 12 }, () => sig("saved", { signal: mapSel("saved") }))

    // (1) save as the production band defines it.
    const prod = aggregateSignals(events(() => FEEDBACK_SIGNAL_MAP.saved))
    // (2) a HYPOTHETICAL retune where Bryan decides "save" is a STRONG positive (high confidence).
    const retuned = aggregateSignals(events(() => ({ polarity: 1, weight: 1.0, confidence: 0.95 })))
    // The retune pushes the multiplier UP without any edit to aggregateSignals/buildRollupRows.
    expect(retuned.multiplier).toBeGreaterThan(prod.multiplier)
    // And dropping the weight to 0 (Bryan removes the action) zeroes its influence entirely.
    const removed = aggregateSignals(events(() => ({ polarity: 1, weight: 0, confidence: 0 })))
    expect(removed.multiplier).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
    expect(removed.supportN).toBe(0)
  })
})

// =================================================================================================
// computePlayTypeKey — stable + low-cardinality.
// =================================================================================================
describe("computePlayTypeKey", () => {
  const play = (over: Partial<EnrichedRecommendation> = {}): EnrichedRecommendation =>
    ({
      title: "Feature the short rib this cold snap",
      rationale: "r",
      skillId: "food-pairing",
      ownerRole: "kitchen",
      kind: "capitalize",
      recipe: [],
      confidence: "high",
      evidenceRefs: ["menu_feature_opportunity:short_rib"],
      knowledgeVersion: "v1",
      severity: 0,
      ...over,
    }) as EnrichedRecommendation

  it("is STABLE across title rewording (keys off skillId|kind|leadDomain|sevBand, not the title)", () => {
    const a = computePlayTypeKey(play({ title: "Feature the short rib" }))
    const b = computePlayTypeKey(play({ title: "Push the braised short rib tonight!!!" }))
    expect(a).toBe(b)
  })

  it("is LOW CARDINALITY: severity collapses to bands; lead-domain to a stem", () => {
    expect(severityBand(0)).toBe("tame")
    expect(severityBand(1)).toBe("tame")
    expect(severityBand(2)).toBe("bold")
    expect(severityBand(3)).toBe("wild")
    expect(severityBand(undefined)).toBe("tame")
    // sev 2 and 3 differ (bold vs wild) but sev 0 and 1 collapse together.
    expect(computePlayTypeKey(play({ severity: 0 }))).toBe(computePlayTypeKey(play({ severity: 1 })))
    expect(computePlayTypeKey(play({ severity: 2 }))).not.toBe(computePlayTypeKey(play({ severity: 3 })))
  })

  it("lead-domain reduces a noisy ref family to a single stem (keeps cardinality low)", () => {
    expect(leadEvidenceDomain(["seo_competitor_growth_trend:pct"])).toBe("seo")
    expect(leadEvidenceDomain(["seo_competitor_overtake"])).toBe("seo")
    expect(leadEvidenceDomain([])).toBe("none")
    expect(leadEvidenceDomain(undefined)).toBe("none")
  })

  it("prefers the skill's declared lead-domain override (stable + intentional)", () => {
    const k = computePlayTypeKey(play({ evidenceRefs: ["whatever_noisy_ref:x"] }), { leadDomainOverride: "menu" })
    expect(k).toBe("food-pairing|capitalize|menu|tame")
  })

  it("produces the canonical 4-part shape", () => {
    expect(computePlayTypeKey(play(), { leadDomainOverride: "menu" }).split("|")).toHaveLength(4)
  })
})

// =================================================================================================
// AGGREGATION — small-N guard, confidence guard, clamp, Bayesian smoothing.
// =================================================================================================
describe("aggregateSignals — guards + smoothing", () => {
  it("small-N → ZERO weight → multiplier 1.0 (one rage-clicker can't move it)", () => {
    // A few thumbs-down, below the support gate → forced neutral.
    const cell = aggregateSignals(many("thumbs_down", PLAY_TYPE_MIN_SUPPORT_N - 1))
    expect(cell.supportN).toBeLessThan(PLAY_TYPE_MIN_SUPPORT_N)
    expect(cell.multiplier).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
  })

  it("empty events → neutral cell (multiplier 1.0)", () => {
    const cell = aggregateSignals([])
    expect(cell.multiplier).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
    expect(cell.supportN).toBe(0)
  })

  it("strong sustained LIKE above support → multiplier ABOVE 1.0, clamped <= MAX", () => {
    const cell = aggregateSignals(many("thumbs_up", 40))
    expect(cell.multiplier).toBeGreaterThan(1.0)
    expect(cell.multiplier).toBeLessThanOrEqual(PLAY_TYPE_MULTIPLIER_MAX)
  })

  it("strong sustained DISLIKE above support → multiplier BELOW 1.0, clamped >= MIN", () => {
    const cell = aggregateSignals(many("thumbs_down", 40))
    expect(cell.multiplier).toBeLessThan(1.0)
    expect(cell.multiplier).toBeGreaterThanOrEqual(PLAY_TYPE_MULTIPLIER_MIN)
  })

  it("CLAMP holds: multiplierFromBayesScore never escapes [0.7, 1.3]", () => {
    for (const s of [0, 0.1, 0.34, 0.5, 0.66, 0.9, 1, -5, 2, NaN]) {
      const m = multiplierFromBayesScore(s)
      expect(m).toBeGreaterThanOrEqual(PLAY_TYPE_MULTIPLIER_MIN)
      expect(m).toBeLessThanOrEqual(PLAY_TYPE_MULTIPLIER_MAX)
    }
    expect(multiplierFromBayesScore(0.5)).toBe(1.0) // neutral midpoint
  })

  it("a low-confidence directional-only stream is harder to move ranking (band confidence guard)", () => {
    // Even a fair number of snooze events (very-low confidence) stays neutral because the support gate
    // counts effective rows and the confidence guard catches a low-trust stream.
    const cell = aggregateSignals(many("snoozed", 10))
    expect(cell.multiplier).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
  })
})

// =================================================================================================
// CONFOUNDER GUARD — a global pattern requires MULTIPLE orgs; else it stays org/location-scoped.
// =================================================================================================
describe("buildRollupRows — confounder guard (global needs multi-org)", () => {
  it("a strong single-org pattern produces org+location rows but NO global row", () => {
    const events = many("thumbs_up", 30, { organizationId: "org-1", locationId: "loc-1" })
    const rows = buildRollupRows(events)
    expect(rows.some((r) => r.scope === "global")).toBe(false)
    expect(rows.some((r) => r.scope === "org" && r.scopeId === "org-1")).toBe(true)
    expect(rows.some((r) => r.scope === "location" && r.scopeId === "loc-1")).toBe(true)
  })

  it("the same pattern across MULTIPLE orgs DOES produce a global row", () => {
    const events = [
      ...many("thumbs_up", 15, { organizationId: "org-1", locationId: "loc-1" }),
      ...many("thumbs_up", 15, { organizationId: "org-2", locationId: "loc-2" }),
    ]
    const rows = buildRollupRows(events)
    const global = rows.find((r) => r.scope === "global")
    expect(global).toBeDefined()
    expect(global!.cell.orgSupportN).toBeGreaterThanOrEqual(GLOBAL_MIN_ORG_SUPPORT_N)
  })
})

// =================================================================================================
// SCORING — multiplier applies alongside category prior; brand_tolerance / category priors DOMINANT.
// =================================================================================================
describe("synthesis multiplier application", () => {
  const base = (over: Partial<ScoreInput> = {}): ScoreInput => ({
    confidence: "medium",
    impact: "medium",
    category: "menu",
    ...over,
  })

  it("EMPTY rollup (no multiplier) → combined == base × prior (byte-identical to pre-P15)", () => {
    const priors = resolveCategoryPriors(null)
    const withNeutral = computeCombinedScore(base({ playTypeMultiplier: 1.0 }), priors)
    const without = computeCombinedScore(base(), priors)
    expect(withNeutral).toBe(without)
  })

  it("the multiplier NUDGES the score up/down within the clamp", () => {
    const priors = resolveCategoryPriors(null)
    const neutral = computeCombinedScore(base({ playTypeMultiplier: 1.0 }), priors)
    const up = computeCombinedScore(base({ playTypeMultiplier: 1.3 }), priors)
    const down = computeCombinedScore(base({ playTypeMultiplier: 0.7 }), priors)
    expect(up).toBeGreaterThan(neutral)
    expect(down).toBeLessThan(neutral)
  })

  it("an out-of-range multiplier is defensively clamped to [0.7,1.3]", () => {
    const priors = resolveCategoryPriors(null)
    const insane = computeCombinedScore(base({ playTypeMultiplier: 99 }), priors)
    const max = computeCombinedScore(base({ playTypeMultiplier: 1.3 }), priors)
    expect(insane).toBe(max)
  })

  it("brand_tolerance/category priors stay DOMINANT: the nudge cannot invert a tolerance signal", () => {
    // A strong-impact, high-confidence play that a real failure signal makes urgent (the "real
    // problem") vs a low-impact maintain habit the feedback loop loves. Even a max feedback boost on
    // the weak play must NOT let it outrank the strong play.
    const priors = resolveCategoryPriors(null)
    const strongProblem = base({ impact: "high", confidence: "high", category: "reputation" })
    const wellLikedHabit = base({
      impact: "low",
      confidence: "directional",
      category: "operations",
      stance: "maintain",
      hasFailureSignal: false,
      playTypeMultiplier: PLAY_TYPE_MULTIPLIER_MAX, // the feedback loop maximally favors it
    })
    expect(computeCombinedScore(strongProblem, priors)).toBeGreaterThan(computeCombinedScore(wellLikedHabit, priors))
  })

  it("EMPTY rollup → ranked ORDER + SCORES byte-identical to ranking with no multiplier", () => {
    type P = EnrichedRecommendation
    const mk = (id: string, conf: ScoreInput["confidence"], cat: ScoreInput["category"]): P =>
      ({
        title: id,
        rationale: "r",
        skillId: cat === "menu" ? "food-pairing" : "operations",
        ownerRole: "kitchen",
        kind: "capitalize",
        recipe: [],
        confidence: conf,
        evidenceRefs: ["x:y"],
        knowledgeVersion: "v1",
      }) as P
    const pool: P[] = [mk("a", "high", "menu"), mk("b", "medium", "operations"), mk("c", "directional", "menu")]
    const priors = resolveCategoryPriors(null)
    const inputNoMult = (p: P): ScoreInput => ({ confidence: p.confidence, impact: "medium", category: p.skillId === "food-pairing" ? "menu" : "operations", ...calibrationOf(p) })
    const inputNeutralMult = (p: P): ScoreInput => ({ ...inputNoMult(p), playTypeMultiplier: NEUTRAL_LOOKUP.multiplierFor("any") })

    const a = rankPlays<P>(pool, inputNoMult, priors)
    const b = rankPlays<P>(pool, inputNeutralMult, priors)
    expect(b.ranked.map((r) => r.item.title)).toEqual(a.ranked.map((r) => r.item.title))
    expect(b.ranked.map((r) => r.score)).toEqual(a.ranked.map((r) => r.score))
    expect(b.priorFlipped).toBe(a.priorFlipped)
  })

  it("a strong pattern NUDGES but does not invert two CLOSE plays unless the gap is small", () => {
    // Two near-identical plays in the same category; only the feedback multiplier differs. The loved
    // one should win — proving the nudge has REAL effect on a genuine tie, but only within the clamp.
    type P = EnrichedRecommendation
    const mk = (id: string): P =>
      ({
        title: id,
        rationale: "r",
        skillId: "food-pairing",
        ownerRole: "kitchen",
        kind: "capitalize",
        recipe: [],
        confidence: "medium",
        evidenceRefs: ["menu:x"],
        knowledgeVersion: "v1",
      }) as P
    const loved = mk("loved")
    const meh = mk("meh")
    const priors = resolveCategoryPriors(null)
    const mult = new Map<P, number>([
      [loved, PLAY_TYPE_MULTIPLIER_MAX],
      [meh, PLAY_TYPE_MULTIPLIER_MIN],
    ])
    const { ranked } = rankPlays<P>(
      [meh, loved],
      (p) => ({ confidence: p.confidence, impact: "medium", category: "menu", ...calibrationOf(p), playTypeMultiplier: mult.get(p) }),
      priors,
    )
    expect(ranked[0].item.title).toBe("loved")
  })
})

// =================================================================================================
// LOADER — fail-soft (absent table → 1.0, no throw); scope precedence; empty → neutral.
// =================================================================================================
function rollupStore(rows: Record<string, unknown>[] | null, opts: { error?: boolean; throws?: boolean } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            in() {
              return {
                in: async () => {
                  if (opts.throws) throw new Error("relation does not exist")
                  return { data: rows, error: opts.error ? { message: "boom" } : null }
                },
              }
            },
          }
        },
      }
    },
  }
}

const rollupRow = (over: Record<string, unknown>): Record<string, unknown> => ({
  skill_id: "food-pairing",
  scope: "global",
  scope_id: null,
  play_type_key: "food-pairing|capitalize|menu|tame",
  multiplier: 1.25,
  support_n: 50,
  ...over,
})

describe("loadPlayTypeMultipliers — fail-soft + precedence", () => {
  it("ABSENT table (throws) → NEUTRAL lookup (every key 1.0, never throws)", async () => {
    const lookup = await loadPlayTypeMultipliers(["food-pairing"], { locationId: "loc-1" }, { client: rollupStore(null, { throws: true }) as never })
    expect(lookup.multiplierFor("anything")).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
  })

  it("query error → NEUTRAL lookup", async () => {
    const lookup = await loadPlayTypeMultipliers(["food-pairing"], {}, { client: rollupStore(null, { error: true }) as never })
    expect(lookup.multiplierFor("food-pairing|capitalize|menu|tame")).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
  })

  it("EMPTY rollup → NEUTRAL lookup (the floor — ranking byte-identical to today)", async () => {
    const lookup = await loadPlayTypeMultipliers(["food-pairing"], { locationId: "loc-1" }, { client: rollupStore([]) as never })
    expect(lookup).toBe(NEUTRAL_LOOKUP)
  })

  it("a below-support row is re-gated to NEUTRAL at read time", async () => {
    const lookup = await loadPlayTypeMultipliers(
      ["food-pairing"],
      {},
      { client: rollupStore([rollupRow({ multiplier: 1.3, support_n: PLAY_TYPE_MIN_SUPPORT_N - 1 })]) as never },
    )
    expect(lookup.multiplierFor("food-pairing|capitalize|menu|tame")).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
  })

  it("a qualifying global row applies; a non-matching scope is ignored", async () => {
    const lookup = await loadPlayTypeMultipliers(
      ["food-pairing"],
      { organizationId: "org-1", locationId: "loc-1" },
      {
        client: rollupStore([
          rollupRow({ scope: "global", scope_id: null, multiplier: 1.2 }),
          rollupRow({ scope: "org", scope_id: "OTHER-ORG", play_type_key: "food-pairing|capitalize|menu|bold", multiplier: 0.7 }),
        ]) as never,
      },
    )
    expect(lookup.multiplierFor("food-pairing|capitalize|menu|tame")).toBeCloseTo(1.2)
    // the other-org row never applies to this location.
    expect(lookup.multiplierFor("food-pairing|capitalize|menu|bold")).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
  })

  it("location-scope wins over org wins over global (precedence)", async () => {
    const key = "food-pairing|capitalize|menu|tame"
    const lookup = await loadPlayTypeMultipliers(
      ["food-pairing"],
      { organizationId: "org-1", locationId: "loc-1" },
      {
        client: rollupStore([
          rollupRow({ scope: "global", scope_id: null, play_type_key: key, multiplier: 1.1 }),
          rollupRow({ scope: "org", scope_id: "org-1", play_type_key: key, multiplier: 1.2 }),
          rollupRow({ scope: "location", scope_id: "loc-1", play_type_key: key, multiplier: 0.8 }),
        ]) as never,
      },
    )
    expect(lookup.multiplierFor(key)).toBeCloseTo(0.8) // location wins
  })
})
