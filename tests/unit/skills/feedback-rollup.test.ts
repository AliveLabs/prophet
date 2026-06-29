import { describe, it, expect } from "vitest"
import {
  FEEDBACK_SIGNAL_MAP,
  signalFor,
  actionForVerdict,
  dismissActionFor,
  dismissReasonCode,
  isDismissReasonCode,
  DISMISS_REASONS,
  type FeedbackAction,
  type FeedbackSignal,
} from "@/lib/skills/feedback-signals"
import {
  aggregateSignals,
  buildRollupRows,
  loadPlayTypeMultipliers,
  runFeedbackRollup,
  NEUTRAL_LOOKUP,
  GLOBAL_MIN_ORG_SUPPORT_N,
  type MappedFeedback,
  type RecomputeStore,
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
  PLAY_TYPE_MIN_CONFIDENCE,
  type ScoreInput,
} from "@/lib/skills/scoring-config"
import { distillFeedbackPatterns, type DistillStore } from "@/lib/skills/feedback-distill-run"
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
// THE BAND — the single tuning point. Thumbs = high-confidence explicit PRIMARY; Keep (saved) =
// positive secondary; Remove (dismissed) + retired Snooze = zero weight. A RETUNE of the map changes
// weights WITHOUT touching rollup code.
// =================================================================================================
describe("feedback-signals BAND", () => {
  it("maps thumbs as the STRONG explicit primary signal (high confidence, full weight, clear polarity)", () => {
    expect(FEEDBACK_SIGNAL_MAP.thumbs_up).toMatchObject({ polarity: 1 })
    expect(FEEDBACK_SIGNAL_MAP.thumbs_down).toMatchObject({ polarity: -1 })
    expect(FEEDBACK_SIGNAL_MAP.thumbs_up.confidence).toBeGreaterThanOrEqual(0.9)
    expect(FEEDBACK_SIGNAL_MAP.thumbs_down.confidence).toBeGreaterThanOrEqual(0.9)
    expect(FEEDBACK_SIGNAL_MAP.thumbs_up.weight).toBe(1.0)
  })

  it("KEEP (saved) is a POSITIVE secondary signal kept BELOW thumbs (2026-06-24 review)", () => {
    expect(FEEDBACK_SIGNAL_MAP.saved.polarity).toBe(1)
    // below thumbs on both weight and confidence, so Keep only nudges — thumbs dominate.
    expect(FEEDBACK_SIGNAL_MAP.saved.weight).toBeLessThan(FEEDBACK_SIGNAL_MAP.thumbs_up.weight)
    expect(FEEDBACK_SIGNAL_MAP.saved.confidence).toBeLessThan(FEEDBACK_SIGNAL_MAP.thumbs_up.confidence)
  })

  it("REMOVE (dismissed) and the retired SNOOZE carry ZERO learning weight (visibility only)", () => {
    // The meeting was explicit: a Remove only controls whether the card is seen — NEVER a negative
    // signal (it may just mean "already did it"). Snooze is retired. Both must contribute nothing.
    for (const a of ["dismissed", "snoozed"] as const) {
      expect(FEEDBACK_SIGNAL_MAP[a].weight).toBe(0)
      expect(FEEDBACK_SIGNAL_MAP[a].confidence).toBe(0)
    }
  })

  it("signalFor degrades an UNKNOWN/legacy action to a true no-op (never throws) — engine isolated", () => {
    expect(signalFor("totally_new_action")).toEqual({ polarity: 0, weight: 0, confidence: 0 })
  })

  it("a REASONED Remove disambiguates the bare dismissal into a directional signal (all BELOW thumbs)", () => {
    // The reason is what turns an ambiguous Remove into something the engine can learn from.
    const lw = FEEDBACK_SIGNAL_MAP["dismissed:looks_wrong"]
    const nr = FEEDBACK_SIGNAL_MAP["dismissed:not_relevant"]
    const ad = FEEDBACK_SIGNAL_MAP["dismissed:already_doing"]
    // "looks wrong" → the strongest reasoned negative, but still below thumbs (it's directional).
    expect(lw.polarity).toBe(-1)
    expect(lw.weight).toBeLessThan(FEEDBACK_SIGNAL_MAP.thumbs_down.weight)
    expect(lw.confidence).toBeLessThan(FEEDBACK_SIGNAL_MAP.thumbs_down.confidence)
    // "not relevant" → a WEAKER negative than "looks wrong" (lower effective mass = weight × confidence).
    expect(nr.polarity).toBe(-1)
    expect(nr.weight * nr.confidence).toBeLessThan(lw.weight * lw.confidence)
    // "already doing it" → NEUTRAL on purpose (not a quality complaint; never a false negative).
    expect(ad).toEqual({ polarity: 0, weight: 0, confidence: 0 })
  })

  it("BOTH negative reasons clear the rollup confidence gate; the neutral one does not even try", () => {
    // looks_wrong (0.6) and not_relevant (0.5) sit AT/above PLAY_TYPE_MIN_CONFIDENCE so they can move
    // ranking on their own; already_doing carries no confidence at all (observe-nothing).
    expect(FEEDBACK_SIGNAL_MAP["dismissed:looks_wrong"].confidence).toBeGreaterThanOrEqual(PLAY_TYPE_MIN_CONFIDENCE)
    expect(FEEDBACK_SIGNAL_MAP["dismissed:not_relevant"].confidence).toBeGreaterThanOrEqual(PLAY_TYPE_MIN_CONFIDENCE)
  })

  it("dismissActionFor composes the band key from a reason code (bare/unknown → no-signal dismissed)", () => {
    expect(dismissActionFor("looks_wrong")).toBe("dismissed:looks_wrong")
    expect(dismissActionFor("not_relevant")).toBe("dismissed:not_relevant")
    expect(dismissActionFor("already_doing")).toBe("dismissed:already_doing")
    expect(dismissActionFor(undefined)).toBe("dismissed")
    expect(dismissActionFor(null)).toBe("dismissed")
    expect(dismissActionFor("garbage")).toBe("dismissed") // unknown → bare, never a fabricated band key
    // and the composed key always resolves to a real band signal (no unknown leaks to signalFor).
    expect(signalFor(dismissActionFor("looks_wrong")).polarity).toBe(-1)
    expect(signalFor(dismissActionFor("garbage"))).toEqual({ polarity: 0, weight: 0, confidence: 0 })
  })

  it("the UI labels and the band codes are ONE source of truth (label ↔ code round-trips)", () => {
    for (const r of DISMISS_REASONS) {
      expect(dismissReasonCode(r.label)).toBe(r.code)
      expect(isDismissReasonCode(r.code)).toBe(true)
    }
    expect(dismissReasonCode("a label that does not exist")).toBeUndefined()
    expect(isDismissReasonCode("garbage")).toBe(false)
    expect(isDismissReasonCode(null)).toBe(false)
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

  it("a Remove/snooze-only stream cannot move ranking (zero-weight signals stay neutral)", () => {
    // Remove (dismissed) and the retired snooze both carry weight 0 — no matter how many, the cell
    // stays neutral. Keep + thumbs are the only signals that move the multiplier (2026-06-24 review).
    expect(aggregateSignals(many("dismissed", 30)).multiplier).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
    expect(aggregateSignals(many("snoozed", 10)).multiplier).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
  })

  it("a sustained REASONED dismissal DOES move ranking — the reason is the difference", () => {
    // The whole point of capturing WHY: "this looks wrong" sustained above support is a real negative
    // and down-ranks the play-type, whereas the SAME count of bare Removes (or "already doing it") does
    // nothing. This is the disambiguation working end to end through the band → aggregate.
    const looksWrong = aggregateSignals(many("dismissed:looks_wrong", 20))
    expect(looksWrong.supportN).toBeGreaterThanOrEqual(PLAY_TYPE_MIN_SUPPORT_N)
    expect(looksWrong.multiplier).toBeLessThan(PLAY_TYPE_MULTIPLIER_NEUTRAL)
    expect(looksWrong.multiplier).toBeGreaterThanOrEqual(PLAY_TYPE_MULTIPLIER_MIN)
    // "already doing it" is NEUTRAL by design — reading it negative would suppress a GOOD rec.
    expect(aggregateSignals(many("dismissed:already_doing", 20)).multiplier).toBe(PLAY_TYPE_MULTIPLIER_NEUTRAL)
    // and "looks wrong" must NOT out-pull an explicit thumbs-down of equal count (stays SECONDARY).
    const thumbsDown = aggregateSignals(many("thumbs_down", 20))
    expect(thumbsDown.multiplier).toBeLessThan(looksWrong.multiplier)
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

// =================================================================================================
// runFeedbackRollup — the upsert must use ONE full-tuple conflict target AND surface a write error.
// Regression guard for the CONFIRMED prod bug: the recompute split into TWO upserts against TWO PARTIAL
// indexes (42P10), and the errors were only console.warn'd — never returned — so the run reported
// success while writing 0 rows. These tests pin the unified conflict target + the surfaced error.
// =================================================================================================
/** A liked play, persisted in a brief, that the feedback play_key (skillId:slug) resolves to. */
const ROLLUP_PLAY = {
  skillId: "food-pairing",
  title: "Feature the hot honey",
  kind: "capitalize",
  evidenceRefs: ["menu_feature:hot_honey"],
  severity: 0,
}
// playKey mirrors the runner: skillId:title-slug.
const ROLLUP_PLAY_KEY = `${ROLLUP_PLAY.skillId}:${ROLLUP_PLAY.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`

/** A RecomputeStore stub: thumbs_up feedback across TWO orgs (so global + scoped rows are built), the
 *  persisted briefs that resolve each play, the locations→org map, and a capturing upsert. */
function recomputeStore(opts: { upsertError?: string } = {}) {
  const captured: { payload: Record<string, unknown>[] | null; onConflict: string | null } = {
    payload: null,
    onConflict: null,
  }
  const thumbs = [
    ...Array.from({ length: 15 }, () => ({ location_id: "loc-1", date_key: "2026-06-20", play_key: ROLLUP_PLAY_KEY, verdict: "good", severity: 0 })),
    ...Array.from({ length: 15 }, () => ({ location_id: "loc-2", date_key: "2026-06-20", play_key: ROLLUP_PLAY_KEY, verdict: "good", severity: 0 })),
  ]
  const briefs = [
    { location_id: "loc-1", date_key: "2026-06-20", brief: { plays: [ROLLUP_PLAY] } },
    { location_id: "loc-2", date_key: "2026-06-20", brief: { plays: [ROLLUP_PLAY] } },
  ]
  const locations = [
    { id: "loc-1", organization_id: "org-1" },
    { id: "loc-2", organization_id: "org-2" },
  ]
  const store: RecomputeStore = {
    from(table: string) {
      return {
        select() {
          return {
            gte: async () => {
              if (table === "brief_feedback") return { data: thumbs, error: null }
              if (table === "play_actions") return { data: [], error: null }
              return { data: [], error: null }
            },
            in: async () => {
              if (table === "daily_briefs") return { data: briefs, error: null }
              if (table === "locations") return { data: locations, error: null }
              return { data: [], error: null }
            },
          }
        },
        upsert: async (rows: Record<string, unknown>[], o: { onConflict: string }) => {
          captured.payload = rows
          captured.onConflict = o.onConflict
          return { error: opts.upsertError ? { message: opts.upsertError } : null }
        },
      }
    },
  } as unknown as RecomputeStore
  return { store, captured }
}

describe("runFeedbackRollup — full dedupe tuple + write errors are SURFACED (prod-bug regression guard)", () => {
  it("upserts skill_feedback_rollup ONCE against the full non-partial dedupe tuple", async () => {
    const { store, captured } = recomputeStore()
    const result = await runFeedbackRollup({ store })
    expect(captured.onConflict).toBe("skill_id,scope,scope_id,play_type_key")
    expect(result.rollupRows).toBeGreaterThan(0)
    // both global (scope_id null) AND scoped rows ride the SAME upsert/tuple now.
    expect(captured.payload!.some((r) => r.scope === "global" && r.scope_id === null)).toBe(true)
    expect(captured.payload!.some((r) => r.scope !== "global")).toBe(true)
    expect(result.rowsWritten).toBe(captured.payload!.length)
    expect(result.writeErrors).toEqual([])
  })

  it("SURFACES an upsert error in result.writeErrors and does NOT increment rowsWritten", async () => {
    const { store } = recomputeStore({ upsertError: "no unique or exclusion constraint matching the ON CONFLICT specification" })
    const result = await runFeedbackRollup({ store })
    expect(result.rollupRows).toBeGreaterThan(0) // work was done
    expect(result.writeErrors.length).toBeGreaterThan(0) // but it can never be invisible again
    expect(result.writeErrors[0].error).toContain("ON CONFLICT")
    expect(result.rowsWritten).toBe(0)
  })
})

// =================================================================================================
// runFeedbackRollup — a REASONED dismissal becomes a learning signal (the new dismiss-reason path).
// Proves the rollup READS play_actions.reason, composes the band action (dismissed:<code>), and that
// the reason — not the bare Remove — is what moves (or doesn't move) the served multiplier.
// =================================================================================================
/** A store with N `dismissed` play_actions carrying `reason`, the brief that resolves the play, the
 *  locations→org map, and a capturing upsert. brief_feedback is empty so ONLY the reasoned dismissals
 *  drive the rollup. (reason: null exercises the bare, no-signal Remove.) */
function reasonedDismissStore(reason: string | null, opts: { count?: number } = {}) {
  const captured: { payload: Record<string, unknown>[] | null } = { payload: null }
  const actions = Array.from({ length: opts.count ?? 12 }, () => ({
    location_id: "loc-1",
    date_key: "2026-06-20",
    play_key: ROLLUP_PLAY_KEY,
    action: "dismissed",
    reason,
  }))
  const briefs = [{ location_id: "loc-1", date_key: "2026-06-20", brief: { plays: [ROLLUP_PLAY] } }]
  const locations = [{ id: "loc-1", organization_id: "org-1" }]
  const store: RecomputeStore = {
    from(table: string) {
      return {
        select() {
          return {
            gte: async () => {
              if (table === "play_actions") return { data: actions, error: null }
              return { data: [], error: null } // brief_feedback empty: only the dismissals drive this
            },
            in: async () => {
              if (table === "daily_briefs") return { data: briefs, error: null }
              if (table === "locations") return { data: locations, error: null }
              return { data: [], error: null }
            },
          }
        },
        upsert: async (rows: Record<string, unknown>[]) => {
          captured.payload = rows
          return { error: null }
        },
      }
    },
  } as unknown as RecomputeStore
  return { store, captured }
}

describe("runFeedbackRollup — reasoned dismissals (reads play_actions.reason → band signal)", () => {
  it("'this looks wrong' sustained above support DOWN-RANKS the play-type (a real negative)", async () => {
    const { store, captured } = reasonedDismissStore("looks_wrong")
    const result = await runFeedbackRollup({ store })
    expect(result.resolved).toBeGreaterThanOrEqual(PLAY_TYPE_MIN_SUPPORT_N) // events grounded to the play
    expect(captured.payload).not.toBeNull()
    // the reason flowed: rollup read reason → dismissActionFor → signalFor(-1) → below-neutral multiplier.
    expect(captured.payload!.some((r) => (r.multiplier as number) < PLAY_TYPE_MULTIPLIER_NEUTRAL)).toBe(true)
    expect(captured.payload!.some((r) => (r.support_n as number) >= PLAY_TYPE_MIN_SUPPORT_N)).toBe(true)
  })

  it("'already doing it' resolves the SAME plays but contributes NO signal (no false negative)", async () => {
    const { store, captured } = reasonedDismissStore("already_doing")
    const result = await runFeedbackRollup({ store })
    expect(result.resolved).toBeGreaterThan(0) // the events DID resolve to a play...
    // ...but they carry zero weight, so every served multiplier stays neutral (the key disambiguation).
    expect(captured.payload!.every((r) => (r.multiplier as number) === PLAY_TYPE_MULTIPLIER_NEUTRAL)).toBe(true)
    expect(captured.payload!.every((r) => (r.support_n as number) === 0)).toBe(true)
  })

  it("a BARE dismissal (reason NULL) stays visibility-only — neutral, exactly as before", async () => {
    const { store, captured } = reasonedDismissStore(null)
    await runFeedbackRollup({ store })
    expect(captured.payload!.every((r) => (r.multiplier as number) === PLAY_TYPE_MULTIPLIER_NEUTRAL)).toBe(true)
  })
})

// =================================================================================================
// distillFeedbackPatterns — the WEEKLY rollup→skill_knowledge writer. Same prod-bug regression guard:
// the upsert must target the full non-partial skill_knowledge dedupe tuple AND surface a write error.
// =================================================================================================
/** Rollup read-rows for ONE org-scoped play family across TWO severity bands, strongly liked + with
 *  real mass — enough for distillPatterns() to emit a candidate (so we reach the upsert). */
function distillRollupRows(): Record<string, unknown>[] {
  const mk = (sevBand: string, supportN: number) => ({
    skill_id: "food-pairing",
    scope: "org",
    scope_id: "org-1",
    play_type_key: `food-pairing|capitalize|menu|${sevBand}`,
    bayes_score: 0.85,
    multiplier: 1.25,
    support_n: supportN,
    org_support_n: 1,
  })
  return [mk("tame", 18), mk("bold", 12)] // 2 bands, total 30 ≥ DISTILL_MIN_SUPPORT_N, liked
}

/** A DistillStore stub: serves the rollup read + captures the skill_knowledge upsert payload/onConflict. */
function distillStore(opts: { upsertError?: string } = {}) {
  const captured: { payload: Record<string, unknown>[] | null; onConflict: string | null } = {
    payload: null,
    onConflict: null,
  }
  const store: DistillStore = {
    from(table: string) {
      return {
        select() {
          return {
            in: async () => ({ data: table === "skill_feedback_rollup" ? distillRollupRows() : [], error: null }),
          }
        },
        upsert: async (rows: Record<string, unknown>[], o: { onConflict: string }) => {
          captured.payload = rows
          captured.onConflict = o.onConflict
          return { error: opts.upsertError ? { message: opts.upsertError } : null }
        },
      }
    },
  }
  return { store, captured }
}

describe("distillFeedbackPatterns — full dedupe tuple + write errors are SURFACED (prod-bug regression guard)", () => {
  it("upserts skill_knowledge ONCE against the full non-partial dedupe tuple", async () => {
    const { store, captured } = distillStore()
    const result = await distillFeedbackPatterns({ store })
    expect(result.candidates).toBeGreaterThan(0)
    expect(captured.onConflict).toBe("skill_id,scope,scope_id,learning_kind,title")
    expect(captured.payload!.length).toBeGreaterThan(0)
    expect(result.rowsWritten).toBe(captured.payload!.length)
    expect(result.writeErrors).toEqual([])
  })

  it("SURFACES an upsert error in result.writeErrors and does NOT increment rowsWritten", async () => {
    const { store } = distillStore({ upsertError: "no unique or exclusion constraint matching the ON CONFLICT specification" })
    const result = await distillFeedbackPatterns({ store })
    expect(result.candidates).toBeGreaterThan(0)
    expect(result.writeErrors.length).toBeGreaterThan(0)
    expect(result.writeErrors[0].error).toContain("ON CONFLICT")
    expect(result.rowsWritten).toBe(0)
  })
})
