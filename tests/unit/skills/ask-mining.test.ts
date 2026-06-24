import { describe, it, expect } from "vitest"
import {
  routeAsk,
  clusterQuestionDemand,
  themeKey,
  ROUTE_MIN_RELEVANCE,
  MIN_CLUSTER_SUPPORT,
  type AskForMining,
  type RoutedAsk,
} from "@/lib/skills/ask-mining"
import {
  canAutoPromote,
  decidePromotions,
  isExpired,
  type PromotableRow,
} from "@/lib/skills/promotion"
import {
  computeShadowObservation,
  overlayShadowMultipliers,
} from "@/lib/skills/shadow"
import { isAllowedTransition, targetStatusFor } from "@/lib/skills/knowledge-admin"
import { runAskMining, type AskMiningStore } from "@/lib/skills/ask-mining-run"
import { runPromotion, type PromotionStore } from "@/lib/skills/promotion-run"
import { rankPlays, type ScoreInput } from "@/lib/skills/scoring-config"
import { CATEGORY_PRIORS } from "@/lib/skills/scoring-config"
import { computePlayTypeKey } from "@/lib/skills/preferences"
import type { EnrichedRecommendation, Category } from "@/lib/skills/types"
import type { PlayTypeMultiplierLookup } from "@/lib/skills/feedback-rollup"

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const ask = (over: Partial<AskForMining>): AskForMining => ({
  id: `a-${Math.random().toString(36).slice(2, 8)}`,
  locationId: "loc-1",
  question: "How should I price my menu vs competitors?",
  grounded: true,
  confidence: "high",
  sources: ["Competitor: O-Ku", "Your menu"],
  createdAt: "2026-06-20T00:00:00Z",
  ...over,
})

const routed = (skillId: string, over: Partial<AskForMining>): RoutedAsk => ({
  ...ask(over),
  skillId,
  relevance: 3,
})

// =================================================================================================
// PIPELINE 3 — ROUTING (guardrail b: relevance threshold; guardrail a: ungrounded dropped)
// =================================================================================================
describe("routeAsk — routing a grounded question to the right skill via the domain map", () => {
  it("routes a menu/competitor pricing question to positioning (direct keyword + cited source)", () => {
    const hits = routeAsk(ask({ question: "Should I raise prices on my menu to match competitors?" }))
    expect(hits.some((h) => h.skillId === "positioning")).toBe(true)
    expect(hits.find((h) => h.skillId === "positioning")!.relevance).toBeGreaterThanOrEqual(ROUTE_MIN_RELEVANCE)
  })

  it("routes a reviews question to reputation, NOT to an off-domain skill like food-pairing", () => {
    const hits = routeAsk(ask({ question: "How do I get more 5-star reviews and respond to complaints?", sources: ["Reviews"] }))
    expect(hits.some((h) => h.skillId === "reputation")).toBe(true)
    expect(hits.some((h) => h.skillId === "food-pairing")).toBe(false)
  })

  it("DROPS an OFF-DOMAIN question below the relevance bar (no billing question pollutes a skill)", () => {
    const hits = routeAsk(ask({ question: "When will my invoice be charged and what is my billing date?", sources: [] }))
    expect(hits).toHaveLength(0)
  })

  it("DROPS an UNGROUNDED question entirely (guardrail a: ungrounded one-offs are noise)", () => {
    const hits = routeAsk(ask({ grounded: false, question: "Should I raise prices on my menu vs competitors?" }))
    expect(hits).toHaveLength(0)
  })

  it("a single keyword hit is below the bar (relevance threshold is > 1)", () => {
    expect(ROUTE_MIN_RELEVANCE).toBeGreaterThan(1)
    // a question with exactly ONE matching keyword and no cited source should not route.
    const hits = routeAsk(ask({ question: "Is this a good event today?", sources: [] }))
    // "event" is one local-demand hit → relevance 1 < bar → dropped.
    expect(hits.some((h) => h.skillId === "local-demand")).toBe(false)
  })
})

// =================================================================================================
// PIPELINE 3 — CLUSTERING + COVERAGE-GAP vs FRAMING (§2.2 P3 a/b)
// =================================================================================================
describe("clusterQuestionDemand — recurring grounded asks → candidate question_demand rows", () => {
  it("needs >= MIN_CLUSTER_SUPPORT distinct grounded asks to distill (repeated, not a one-off)", () => {
    const few = Array.from({ length: MIN_CLUSTER_SUPPORT - 1 }, (_, i) =>
      routed("reputation", { id: `r${i}`, question: "how to get more google reviews", sources: ["Reviews"] }),
    )
    expect(clusterQuestionDemand("reputation", few)).toHaveLength(0)
  })

  it("a COVERAGE GAP (asks not grounded in the brief) → learning_kind question_demand, status candidate", () => {
    const asks = Array.from({ length: 4 }, (_, i) =>
      routed("reputation", { id: `r${i}`, question: "how do I get more google reviews", sources: ["Reviews"] }),
    )
    const out = clusterQuestionDemand("reputation", asks)
    expect(out).toHaveLength(1)
    expect(out[0].learningKind).toBe("question_demand")
    expect(out[0].demandType).toBe("coverage_gap")
    expect(out[0].status).toBe("candidate") // ★ always candidate
    expect(out[0].sampleAskIds.length).toBeGreaterThan(0)
  })

  it("a FRAMING cluster (follow-ups reference the brief/plays) → editorial kind, still candidate", () => {
    const asks = Array.from({ length: 4 }, (_, i) =>
      routed("reputation", {
        id: `f${i}`,
        question: "why did the brief recommend replying to reviews",
        sources: ["This week's brief", "Current recommendations"],
      }),
    )
    const out = clusterQuestionDemand("reputation", asks)
    expect(out).toHaveLength(1)
    expect(out[0].demandType).toBe("framing")
    expect(out[0].learningKind).toBe("editorial")
    expect(out[0].status).toBe("candidate")
  })

  it("themeKey is order-independent so reworded asks cluster together", () => {
    expect(themeKey("how to get more reviews up")).toBe(themeKey("get reviews more"))
  })
})

// =================================================================================================
// AUTO-PROMOTION — corroborated trend + supported feedback promote; question_demand NEVER does
// =================================================================================================
describe("canAutoPromote — the auto-promotion matrix (§2.3.3 / §2.4)", () => {
  const row = (over: Partial<PromotableRow>): PromotableRow => ({
    id: "k1",
    skillId: "food-pairing",
    learningKind: "external_trend",
    status: "candidate",
    confidence: 80,
    supportN: 3,
    effectiveToMs: null,
    ...over,
  })

  it("promotes a CORROBORATED, confident external_trend (candidate → active)", () => {
    expect(canAutoPromote(row({ learningKind: "external_trend", supportN: 2, confidence: 75 }))).toBe(true)
  })

  it("does NOT promote a lone/low external_trend (support or confidence below the bar)", () => {
    expect(canAutoPromote(row({ learningKind: "external_trend", supportN: 1, confidence: 95 }))).toBe(false)
    expect(canAutoPromote(row({ learningKind: "external_trend", supportN: 3, confidence: 40 }))).toBe(false)
  })

  it("promotes a SUPPORTED feedback_pattern from candidate, but NEVER a shadow (negative) one", () => {
    expect(canAutoPromote(row({ learningKind: "feedback_pattern", status: "candidate", supportN: 25, confidence: 70 }))).toBe(true)
    // a shadow feedback_pattern (the conservative negative direction) is human-only.
    expect(canAutoPromote(row({ learningKind: "feedback_pattern", status: "shadow", supportN: 99, confidence: 95 }))).toBe(false)
  })

  it("★ NEVER auto-promotes a question_demand row, regardless of confidence/support", () => {
    expect(canAutoPromote(row({ learningKind: "question_demand", status: "candidate", supportN: 999, confidence: 100 }))).toBe(false)
    expect(canAutoPromote(row({ learningKind: "question_demand", status: "shadow", supportN: 999, confidence: 100 }))).toBe(false)
  })

  it("★ NEVER auto-promotes an editorial (framing) row either — human-only", () => {
    expect(canAutoPromote(row({ learningKind: "editorial", status: "candidate", supportN: 999, confidence: 100 }))).toBe(false)
  })
})

describe("decidePromotions — the weekly auto-promote + retire pass", () => {
  const now = Date.parse("2026-06-24T00:00:00Z")
  const row = (over: Partial<PromotableRow>): PromotableRow => ({
    id: `k-${Math.random().toString(36).slice(2, 7)}`,
    skillId: "food-pairing",
    learningKind: "external_trend",
    status: "candidate",
    confidence: 80,
    supportN: 2,
    effectiveToMs: null,
    ...over,
  })

  it("promotes a corroborated trend + a supported feedback_pattern but leaves question_demand alone", () => {
    const rows = [
      row({ id: "trend", learningKind: "external_trend", supportN: 2, confidence: 75 }),
      row({ id: "fb", learningKind: "feedback_pattern", status: "candidate", supportN: 25, confidence: 70 }),
      row({ id: "q", learningKind: "question_demand", status: "candidate", supportN: 99, confidence: 100 }),
    ]
    const decisions = decidePromotions(rows, now)
    const promoted = decisions.filter((d) => d.to === "active").map((d) => d.id).sort()
    expect(promoted).toEqual(["fb", "trend"])
    // question_demand is NOT in any decision.
    expect(decisions.some((d) => d.id === "q")).toBe(false)
  })

  it("RETIRES an active row whose window expired (drops from the next prompt build)", () => {
    const rows = [
      row({ id: "stale", learningKind: "external_trend", status: "active", effectiveToMs: now - 1000 }),
      row({ id: "live", learningKind: "external_trend", status: "active", effectiveToMs: now + 86_400_000 }),
    ]
    const decisions = decidePromotions(rows, now)
    expect(decisions.filter((d) => d.to === "retired").map((d) => d.id)).toEqual(["stale"])
    expect(decisions.some((d) => d.id === "live")).toBe(false)
  })

  it("does NOT promote an already-expired candidate trend (would just retire next pass)", () => {
    const decisions = decidePromotions(
      [row({ id: "deadtrend", learningKind: "external_trend", status: "candidate", supportN: 3, confidence: 90, effectiveToMs: now - 1 })],
      now,
    )
    expect(decisions).toHaveLength(0)
  })

  it("isExpired: open-ended (null) never expires; a past effective_to does", () => {
    expect(isExpired({ effectiveToMs: null }, now)).toBe(false)
    expect(isExpired({ effectiveToMs: now + 1 }, now)).toBe(false)
    expect(isExpired({ effectiveToMs: now - 1 }, now)).toBe(true)
  })
})

// =================================================================================================
// SHADOW MODE — computed + logged, but NEVER changes the served brief (§2.3.3)
// =================================================================================================
describe("shadow mode — a shadow row is computed but does NOT change the served ranking", () => {
  // Two plays in the SAME category so the only thing that can reorder them is a play-type multiplier.
  const play = (title: string, conf: EnrichedRecommendation["confidence"]): EnrichedRecommendation =>
    ({
      title,
      rationale: "r",
      skillId: "food-pairing",
      kind: "capitalize",
      confidence: conf,
      evidenceRefs: ["menu.item"],
      severity: 0,
    }) as unknown as EnrichedRecommendation

  // Two plays with IDENTICAL base scores (same confidence + impact) but DISTINCT play_type_keys, so
  // the only thing that can flip them is a play-type multiplier. (Distinct keys via different kind.)
  const playB = { ...play("Add a seasonal dessert", "high"), kind: "prepare" } as unknown as EnrichedRecommendation
  const pool = [play("Feature the hot-honey LTO", "high"), playB]
  const priors = CATEGORY_PRIORS as Record<Category, number>
  const keyOf = (p: EnrichedRecommendation) => computePlayTypeKey(p)

  // served lookup = neutral (no active rollup); a play's scoreInput uses it.
  const NEUTRAL: PlayTypeMultiplierLookup = { multiplierFor: () => 1.0 }
  const baseScoreInput = (p: EnrichedRecommendation): ScoreInput => ({
    confidence: p.confidence,
    impact: p.leverage?.label,
    category: "marketing",
    playTypeMultiplier: NEUTRAL.multiplierFor(keyOf(p)),
  })

  it("a shadow multiplier that WOULD reorder the pool is detected — but the served ranking is unchanged", () => {
    // The served ranking (neutral): high-confidence play first.
    const served = rankPlays(pool, baseScoreInput, priors).ranked.map((r) => r.item.title)
    expect(served[0]).toBe("Feature the hot-honey LTO")

    // A shadow lookup that BOOSTS the SECOND play's type hard enough to flip the order.
    const secondKey = keyOf(pool[1])
    const shadow: PlayTypeMultiplierLookup = { multiplierFor: (k) => (k === secondKey ? 1.3 : 1.0) }
    const shadowScoreInput = (p: EnrichedRecommendation): ScoreInput => ({
      ...baseScoreInput(p),
      playTypeMultiplier: overlayShadowMultipliers(NEUTRAL, shadow).multiplierFor(keyOf(p)),
    })

    const obs = computeShadowObservation(pool, baseScoreInput, shadowScoreInput, priors, 7, 1, keyOf)
    // The shadow replay WOULD reorder (it observed a change)...
    expect(obs.wouldReorder).toBe(true)
    expect(obs.shadowSignalCount).toBe(1)

    // ...but the SERVED ranking (re-derived without shadow) is byte-identical to before.
    const servedAgain = rankPlays(pool, baseScoreInput, priors).ranked.map((r) => r.item.title)
    expect(servedAgain).toEqual(served)
  })

  it("zero shadow signals → empty observation, nothing to log (the floor = today)", () => {
    const obs = computeShadowObservation(pool, baseScoreInput, baseScoreInput, priors, 7, 0, keyOf)
    expect(obs.wouldReorder).toBe(false)
    expect(obs.wouldChangeSelection).toBe(false)
    expect(obs.movedKeys).toEqual([])
  })

  it("a shadow multiplier that does NOT change order reports no reorder", () => {
    // a tiny boost to the ALREADY-top play can't reorder.
    const topKey = keyOf(pool[0])
    const shadow: PlayTypeMultiplierLookup = { multiplierFor: (k) => (k === topKey ? 1.05 : 1.0) }
    const shadowScoreInput = (p: EnrichedRecommendation): ScoreInput => ({
      ...baseScoreInput(p),
      playTypeMultiplier: overlayShadowMultipliers(NEUTRAL, shadow).multiplierFor(keyOf(p)),
    })
    const obs = computeShadowObservation(pool, baseScoreInput, shadowScoreInput, priors, 7, 1, keyOf)
    expect(obs.wouldReorder).toBe(false)
  })
})

// =================================================================================================
// HUMAN PROMOTION GATE — the admin transition policy (knowledge-admin.ts)
// =================================================================================================
describe("isAllowedTransition — the human promote/retire/shadow gate", () => {
  it("promote (→active) is allowed from candidate or shadow, not from active/retired", () => {
    expect(isAllowedTransition("candidate", "promote")).toBe(true)
    expect(isAllowedTransition("shadow", "promote")).toBe(true)
    expect(isAllowedTransition("active", "promote")).toBe(false)
    expect(isAllowedTransition("retired", "promote")).toBe(false)
  })

  it("retire (→retired) is allowed from candidate, shadow, OR active (instant rollback)", () => {
    expect(isAllowedTransition("candidate", "retire")).toBe(true)
    expect(isAllowedTransition("shadow", "retire")).toBe(true)
    expect(isAllowedTransition("active", "retire")).toBe(true)
    expect(isAllowedTransition("retired", "retire")).toBe(false) // no-op
  })

  it("shadow (→shadow) is allowed from candidate or active, never a no-op", () => {
    expect(isAllowedTransition("candidate", "shadow")).toBe(true)
    expect(isAllowedTransition("active", "shadow")).toBe(true)
    expect(isAllowedTransition("shadow", "shadow")).toBe(false) // no-op
  })

  it("targetStatusFor maps each action to its status", () => {
    expect(targetStatusFor("promote")).toBe("active")
    expect(targetStatusFor("retire")).toBe("retired")
    expect(targetStatusFor("shadow")).toBe("shadow")
  })
})

// =================================================================================================
// RUNNERS — end-to-end over a stubbed loose store (deterministic, no DB)
// =================================================================================================
/** A stubbed AskMiningStore: serves ask_history rows, captures the skill_knowledge upsert payload,
 *  and serves existing skill_knowledge rows for the human-decision lock check. */
function askStore(asks: Record<string, unknown>[], existing: Record<string, unknown>[] = [], opts: { upsertError?: string } = {}) {
  const captured: { payload: Record<string, unknown>[] | null; onConflict: string | null } = { payload: null, onConflict: null }
  const store: AskMiningStore = {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            gte: async () => ({ data: table === "ask_history" ? asks : [], error: null }),
            in: async () => ({ data: table === "skill_knowledge" ? existing : [], error: null }),
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

describe("runAskMining — weekly distill writes ONLY candidate question_demand rows", () => {
  const askRows = Array.from({ length: 4 }, (_, i) => ({
    id: `q${i}`,
    location_id: "loc-1",
    question: "how do I get more google reviews and respond to complaints",
    grounded: true,
    confidence: "high",
    sources: ["Reviews"],
    created_at: "2026-06-20T00:00:00Z",
  }))

  it("clusters grounded asks and upserts every row as status='candidate' (NEVER active/shadow)", async () => {
    const { store, captured } = askStore(askRows)
    const result = await runAskMining({ store, mode: "weekly" })
    expect(result.candidates).toBeGreaterThan(0)
    expect(result.rowsWritten).toBe(captured.payload!.length)
    expect(captured.payload!.length).toBeGreaterThan(0)
    // ON CONFLICT must target the full non-partial dedupe tuple (the old "skill_id,learning_kind,title"
    // hit a PARTIAL index → 42P10 → swallowed → 0 rows). Candidate rows are all global, scope_id null.
    expect(captured.onConflict).toBe("skill_id,scope,scope_id,learning_kind,title")
    for (const row of captured.payload!) {
      expect(row.status).toBe("candidate") // ★ human-only — never auto-promoted by the runner.
      expect(["question_demand", "editorial"]).toContain(row.learning_kind)
      expect(row.scope).toBe("global")
      expect(row.scope_id).toBeNull() // set EXPLICITLY (not omitted) so NULLS NOT DISTINCT dedups.
      // provenance carries sample ask ids as PROVENANCE only (never a citable evidenceRef).
      expect((row.provenance as Record<string, unknown>).streams).toEqual(["ask"])
    }
    expect(result.writeErrors).toEqual([])
  })

  it("SURFACES an upsert error in result.writeErrors and does NOT increment rowsWritten (regression guard)", async () => {
    const { store } = askStore(askRows, [], { upsertError: "no unique or exclusion constraint matching the ON CONFLICT specification" })
    const result = await runAskMining({ store, mode: "weekly" })
    // The run still succeeds (fail-soft) and reports the distilled candidates...
    expect(result.candidates).toBeGreaterThan(0)
    // ...but the write failure can NEVER be invisible again: surfaced in writeErrors + rowsWritten 0.
    expect(result.writeErrors.length).toBeGreaterThan(0)
    expect(result.writeErrors[0].error).toContain("ON CONFLICT")
    expect(result.rowsWritten).toBe(0)
  })

  it("the NIGHTLY pass routes but writes NOTHING", async () => {
    const { store, captured } = askStore(askRows)
    const result = await runAskMining({ store, mode: "nightly" })
    expect(result.rowsWritten).toBe(0)
    expect(captured.payload).toBeNull()
    expect(result.routedPairs).toBeGreaterThan(0)
  })

  it("a missing/unreadable ask_history → no-op (floor = today)", async () => {
    const store: AskMiningStore = {
      from() {
        return {
          select() {
            return {
              gte: async () => ({ data: null, error: { message: "relation does not exist" } }),
              in: async () => ({ data: null, error: null }),
            }
          },
          upsert: async () => ({ error: null }),
        }
      },
    }
    const result = await runAskMining({ store, mode: "weekly" })
    expect(result.asksRead).toBe(0)
    expect(result.rowsWritten).toBe(0)
  })

  it("does NOT re-write a row a human already promoted (status no longer 'candidate')", async () => {
    // The cluster will produce a question_demand candidate; an existing ACTIVE row with the same
    // (skill, kind, title) means a human already decided — the weekly upsert must skip it.
    const { store, captured } = askStore(askRows)
    // First derive the title the cluster would produce, then re-run with that row pre-existing+active.
    const first = await runAskMining({ store, mode: "weekly" })
    const writtenTitle = String(captured.payload![0].title)
    const writtenSkill = String(captured.payload![0].skill_id)
    const writtenKind = String(captured.payload![0].learning_kind)
    expect(first.rowsWritten).toBeGreaterThan(0)

    const locked = askStore(askRows, [
      { skill_id: writtenSkill, learning_kind: writtenKind, title: writtenTitle, status: "active" },
    ])
    const second = await runAskMining({ store: locked.store, mode: "weekly" })
    // the locked (skill, kind, title) row is dropped from the payload (human decision preserved); other
    // skills sharing the theme title are NOT locked, so the lock is precise per-skill.
    const lockedPresent = (locked.captured.payload ?? []).some(
      (r) => String(r.skill_id) === writtenSkill && String(r.learning_kind) === writtenKind && String(r.title) === writtenTitle,
    )
    expect(lockedPresent).toBe(false)
    expect(second.rowsWritten).toBeLessThan(first.rowsWritten)
  })
})

describe("runPromotion — applies the auto-promote/retire flips; never touches question_demand", () => {
  function promoStore(rows: Record<string, unknown>[]) {
    const updates: Array<{ id: string; status: string }> = []
    const store: PromotionStore = {
      from() {
        return {
          select() {
            return { in: async () => ({ data: rows, error: null }) }
          },
          update(patch: Record<string, unknown>) {
            return {
              eq: async (_c: string, id: string) => {
                updates.push({ id, status: String(patch.status) })
                return { error: null }
              },
            }
          },
        }
      },
    }
    return { store, updates }
  }

  it("promotes a corroborated trend + supported feedback, retires an expired active, skips question_demand", async () => {
    const now = Date.parse("2026-06-24T00:00:00Z")
    const rows = [
      { id: "trend", skill_id: "food-pairing", learning_kind: "external_trend", status: "candidate", confidence: 80, support_n: 2, effective_to: null },
      { id: "fb", skill_id: "marketing", learning_kind: "feedback_pattern", status: "candidate", confidence: 70, support_n: 25, effective_to: null },
      { id: "q", skill_id: "reputation", learning_kind: "question_demand", status: "candidate", confidence: 100, support_n: 99, effective_to: null },
      { id: "stale", skill_id: "operations", learning_kind: "external_trend", status: "active", confidence: 90, support_n: 3, effective_to: "2020-01-01T00:00:00Z" },
    ]
    const { store, updates } = promoStore(rows)
    const result = await runPromotion({ store, nowMs: now })
    expect(result.promoted).toBe(2)
    expect(result.retired).toBe(1)
    const byId = Object.fromEntries(updates.map((u) => [u.id, u.status]))
    expect(byId.trend).toBe("active")
    expect(byId.fb).toBe("active")
    expect(byId.stale).toBe("retired")
    // ★ the question_demand row was NEVER updated.
    expect(updates.some((u) => u.id === "q")).toBe(false)
  })

  it("a missing skill_knowledge table → no-op run (floor = today)", async () => {
    const store: PromotionStore = {
      from() {
        return {
          select() {
            return { in: async () => ({ data: null, error: { message: "no relation" } }) }
          },
          update() {
            return { eq: async () => ({ error: null }) }
          },
        }
      },
    }
    const result = await runPromotion({ store })
    expect(result.promoted).toBe(0)
    expect(result.retired).toBe(0)
    expect(result.rowsConsidered).toBe(0)
  })
})
