import { describe, it, expect, beforeEach } from "vitest"
import {
  loadActiveKnowledge,
  effectiveKnowledgeVersion,
  clearKnowledgeCache,
  type KnowledgeInjection,
  type KnowledgeSnippet,
} from "@/lib/skills/knowledge-feeds"
import { buildSkillPrompt } from "@/lib/skills/prompt-kit"
import {
  passesDistillGate,
  corroborate,
  parseRssItems,
  type DistillVerdict,
  type DistilledHit,
  type SourceRow,
} from "@/lib/skills/ingest-knowledge"
import { foodPairingSkill } from "@/lib/skills/food-pairing/skill"
import type { Dossier } from "@/lib/insights/dossier/types"

// ── A minimal dossier good enough for prompt building (only the fields buildSkillPrompt reads). ────
function makeDossier(): Dossier {
  return {
    locationId: "loc-1",
    tier: { tier: 2 },
    ruleOutputs: [],
    profile: {
      locationId: "loc-1",
      name: "Test Diner",
      timezone: "America/Chicago",
      voiceTone: "casual",
      attributes: { cuisine: "American", priceTier: "$$" },
      capability: { liveChannels: ["instagram"] },
    },
  } as unknown as Dossier
}

// ── A loose-store stub matching the loader's chained eq/eq/in surface. ─────────────────────────────
function knowledgeStore(rows: Record<string, unknown>[] | null, opts: { error?: boolean; throws?: boolean } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    in: async () => {
                      if (opts.throws) throw new Error("table does not exist")
                      return { data: rows, error: opts.error ? { message: "boom" } : null }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

const baseRow = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "k1",
  skill_id: "food-pairing",
  scope: "global",
  scope_id: null,
  learning_kind: "external_trend",
  title: "Hot sauce is trending",
  snippet: "Per NRA What's Hot, bold global hot sauces are a durable upsell; feature one as a limited topping.",
  confidence: 80,
  effective_from: "2026-01-01T00:00:00Z",
  effective_to: null,
  ...over,
})

beforeEach(() => clearKnowledgeCache())

describe("loadActiveKnowledge — fail-soft (the floor is today)", () => {
  it("returns EMPTY (never throws) when the table does not exist", async () => {
    const out = await loadActiveKnowledge("food-pairing", { locationId: "loc-1" }, { client: knowledgeStore(null, { throws: true }) })
    expect(out).toEqual({ global: [], scoped: [], globalVersion: "" })
  })

  it("returns EMPTY when the query errors", async () => {
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore(null, { error: true }) })
    expect(out.global).toEqual([])
    expect(out.scoped).toEqual([])
    expect(out.globalVersion).toBe("")
  })

  it("returns EMPTY when there are no active rows", async () => {
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore([]) })
    expect(out.global).toHaveLength(0)
    expect(out.globalVersion).toBe("")
  })

  it("drops malformed rows (empty snippet / unknown scope) rather than injecting noise", async () => {
    const out = await loadActiveKnowledge(
      "food-pairing",
      {},
      { client: knowledgeStore([baseRow({ id: "bad", snippet: "  " }), baseRow({ id: "ok2", title: "Real one" })]) },
    )
    expect(out.global.map((s) => s.id)).toEqual(["ok2"])
  })
})

describe("loadActiveKnowledge — scope split (cache discipline)", () => {
  it("puts global rows in .global and matching org/location rows in .scoped", async () => {
    const rows = [
      baseRow({ id: "g1", scope: "global", scope_id: null }),
      baseRow({ id: "o1", scope: "org", scope_id: "org-1", title: "Org learning" }),
      baseRow({ id: "l1", scope: "location", scope_id: "loc-1", title: "Loc learning" }),
      baseRow({ id: "other", scope: "location", scope_id: "loc-999", title: "Other loc" }),
    ]
    const out = await loadActiveKnowledge(
      "food-pairing",
      { organizationId: "org-1", locationId: "loc-1" },
      { client: knowledgeStore(rows) },
    )
    expect(out.global.map((s) => s.id)).toEqual(["g1"])
    expect(out.scoped.map((s) => s.id).sort()).toEqual(["l1", "o1"])
    // a different location's row is ignored.
    expect(out.scoped.find((s) => s.id === "other")).toBeUndefined()
  })

  it("never injects a kind the skill did not declare (acceptedLearningKinds defense in depth)", async () => {
    // The skill accepts ONLY external_trend/editorial — a feedback_pattern row is active in-window
    // and well-formed, but must STILL be dropped (defense in depth on top of scope/window/status).
    const rows = [
      baseRow({ id: "trend", learning_kind: "external_trend" }),
      baseRow({ id: "edit", learning_kind: "editorial", title: "Editorial note" }),
      baseRow({ id: "fb", learning_kind: "feedback_pattern", title: "Feedback pattern" }),
      baseRow({ id: "q", learning_kind: "question_demand", title: "Question demand" }),
      baseRow({ id: "fb-loc", scope: "location", scope_id: "loc-1", learning_kind: "feedback_pattern", title: "Scoped feedback" }),
    ]
    const out = await loadActiveKnowledge(
      "food-pairing",
      { locationId: "loc-1" },
      { client: knowledgeStore(rows), acceptedKinds: ["external_trend", "editorial"] },
    )
    expect(out.global.map((s) => s.id).sort()).toEqual(["edit", "trend"])
    // the disallowed kinds are gone from BOTH global and scoped — even the in-scope location row.
    expect(out.scoped).toHaveLength(0)
    expect([...out.global, ...out.scoped].some((s) => s.learningKind === "feedback_pattern")).toBe(false)
    expect([...out.global, ...out.scoped].some((s) => s.learningKind === "question_demand")).toBe(false)
  })

  it("accepts ALL kinds when no acceptedKinds filter is passed (back-compat: no learning hook)", async () => {
    const rows = [
      baseRow({ id: "trend", learning_kind: "external_trend" }),
      baseRow({ id: "fb", learning_kind: "feedback_pattern", title: "Feedback pattern" }),
    ]
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore(rows) })
    expect(out.global.map((s) => s.id).sort()).toEqual(["fb", "trend"])
  })

  it("a declared-but-EMPTY acceptedKinds injects nothing (the floor)", async () => {
    const rows = [baseRow({ id: "trend", learning_kind: "external_trend" })]
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore(rows), acceptedKinds: [] })
    expect(out.global).toHaveLength(0)
    expect(out.globalVersion).toBe("")
  })

  it("filters out rows outside the active window (self-retiring trends)", async () => {
    const rows = [
      baseRow({ id: "expired", effective_to: "2020-01-01T00:00:00Z" }),
      baseRow({ id: "live", title: "Still live", effective_to: "2999-01-01T00:00:00Z" }),
    ]
    const out = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore(rows), nowMs: Date.parse("2026-06-24T00:00:00Z") })
    expect(out.global.map((s) => s.id)).toEqual(["live"])
  })
})

describe("effectiveKnowledgeVersion — cache key includes the version", () => {
  const inj = (global: KnowledgeSnippet[]): KnowledgeInjection => ({
    global,
    scoped: [],
    globalVersion: global.length ? "abc1234" : "",
  })
  const snip = (id: string): KnowledgeSnippet => ({
    id,
    skillId: "food-pairing",
    scope: "global",
    scopeId: null,
    learningKind: "external_trend",
    title: "t",
    snippet: "s",
    confidence: 50,
  })

  it("EMPTY global set → base version UNCHANGED (byte-identical-cache-key property)", () => {
    expect(effectiveKnowledgeVersion("food-pairing@v1", inj([]))).toBe("food-pairing@v1")
  })

  it("non-empty global set → base + hash tag", () => {
    const v = effectiveKnowledgeVersion("food-pairing@v1", inj([snip("a")]))
    expect(v).toBe("food-pairing@v1+fabc1234")
    expect(v).not.toBe("food-pairing@v1")
  })

  it("the loader's globalVersion is order-independent + changes when the set changes", async () => {
    const a = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore([baseRow({ id: "x" }), baseRow({ id: "y", title: "Y" })]) })
    clearKnowledgeCache()
    // same two ids, reversed row order → same fingerprint (sorted ids).
    const b = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore([baseRow({ id: "y", title: "Y" }), baseRow({ id: "x" })]) })
    expect(a.globalVersion).toBe(b.globalVersion)
    clearKnowledgeCache()
    // different id set → different fingerprint.
    const c = await loadActiveKnowledge("food-pairing", {}, { client: knowledgeStore([baseRow({ id: "z" })]) })
    expect(c.globalVersion).not.toBe(a.globalVersion)
  })
})

describe("prompt injection — placement + byte-identical floor", () => {
  const d = makeDossier()
  const TRENDS_HEADER = "CURRENT TRENDS & LEARNED PRIORS (informational; never override the operator's own reality or the evidence)"

  it("EMPTY active set leaves systemCached BYTE-IDENTICAL to today (no knowledge arg)", () => {
    const today = buildSkillPrompt(foodPairingSkill, d, { x: 1 })
    const withEmpty = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, { global: [], scoped: [], globalVersion: "" })
    expect(withEmpty.systemCached).toBe(today.systemCached)
    expect(withEmpty.system).toBe(today.system)
    // and the block is genuinely absent.
    expect(withEmpty.systemCached).not.toContain(TRENDS_HEADER)
  })

  it("injects the trends block AFTER the DOMAIN PLAYBOOK and BEFORE the RULES", () => {
    const knowledge: KnowledgeInjection = {
      global: [
        { id: "g", skillId: "food-pairing", scope: "global", scopeId: null, learningKind: "external_trend", title: "Hot honey", snippet: "Hot honey keeps trending; feature it on a sweet-heat item.", confidence: 80 },
      ],
      scoped: [],
      globalVersion: "deadbeef",
    }
    const out = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, knowledge)
    const sc = out.systemCached
    const idxPlaybook = sc.indexOf("DOMAIN PLAYBOOK:")
    const idxTrends = sc.indexOf(TRENDS_HEADER)
    const idxRules = sc.indexOf("RULES:")
    expect(idxPlaybook).toBeGreaterThanOrEqual(0)
    expect(idxTrends).toBeGreaterThan(idxPlaybook)
    expect(idxRules).toBeGreaterThan(idxTrends)
    expect(sc).toContain("Hot honey")
  })

  it("GLOBAL snippets ride systemCached; SCOPED snippets ride the volatile system block (cache discipline)", () => {
    const knowledge: KnowledgeInjection = {
      global: [{ id: "g", skillId: "food-pairing", scope: "global", scopeId: null, learningKind: "external_trend", title: "Global trend", snippet: "global snippet text", confidence: 70 }],
      scoped: [{ id: "l", skillId: "food-pairing", scope: "location", scopeId: "loc-1", learningKind: "feedback_pattern", title: "Local pattern", snippet: "scoped snippet text", confidence: 60 }],
      globalVersion: "v",
    }
    const out = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, knowledge)
    // global → cached prefix only; scoped → volatile system only. Never crossed.
    expect(out.systemCached).toContain("global snippet text")
    expect(out.systemCached).not.toContain("scoped snippet text")
    expect(out.system).toContain("scoped snippet text")
    expect(out.system).not.toContain("global snippet text")
    // adding ONLY a scoped snippet must NOT change systemCached vs. the global-only build (so a
    // per-location learning can never bust the shared 13-location prefix cache).
    const globalOnly = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, { global: knowledge.global, scoped: [], globalVersion: "v" })
    expect(out.systemCached).toBe(globalOnly.systemCached)
  })

  it("the injected block reasserts that trends NEVER override evidence/grounding (grounding stays sacred)", () => {
    const knowledge: KnowledgeInjection = {
      global: [{ id: "g", skillId: "food-pairing", scope: "global", scopeId: null, learningKind: "external_trend", title: "T", snippet: "s", confidence: 80 }],
      scoped: [],
      globalVersion: "v",
    }
    const out = buildSkillPrompt(foodPairingSkill, d, { x: 1 }, knowledge)
    expect(out.systemCached).toContain("never cite a trend as an evidenceRef")
    expect(out.systemCached).toContain("the evidence wins")
    // the static GROUNDING rule is still present and untouched.
    expect(out.systemCached).toContain("allowedEvidenceRefs list below")
    expect(out.systemCached).toContain("If you cannot ground a play, do not make it.")
  })
})

// ── PIPELINE 1 validation gates ─────────────────────────────────────────────────────────────────
const src = (id: string, tier: 1 | 2 | 3): SourceRow => ({
  id,
  skillIds: ["food-pairing"],
  name: `Source ${id}`,
  vertical: "culinary",
  url: `https://example.com/${id}`,
  fetchStrategy: "rss",
  authKind: "none",
  trustTier: tier,
  enabled: true,
})
const verdict = (over: Partial<DistillVerdict>): DistillVerdict => ({
  snippet: "Durable tactic: feature a seasonal hot-honey item; it has lasting appeal.",
  title: "Hot honey demand",
  confidence: 80,
  attributable: true,
  ...over,
})

describe("adversarial distill gate (b)", () => {
  it("DROPS a low-confidence verdict and KEEPS a durable, attributable one", () => {
    expect(passesDistillGate(verdict({ confidence: 80, attributable: true }))).toBe(true)
    expect(passesDistillGate(verdict({ confidence: 30 }))).toBe(false) // below the floor
  })

  it("DROPS an unattributable verdict even at high confidence", () => {
    expect(passesDistillGate(verdict({ confidence: 95, attributable: false }))).toBe(false)
  })
})

describe("corroboration gate (c)", () => {
  it("a lone TIER-3 source caps at SHADOW (never active)", () => {
    const hits: DistilledHit[] = [{ verdict: verdict({ confidence: 95 }), source: src("t3", 3) }]
    const rows = corroborate("food-pairing", hits)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("shadow")
  })

  it(">=2 TIER-1 sources asserting the same trend AUTO-PROMOTE to active", () => {
    const hits: DistilledHit[] = [
      { verdict: verdict({ confidence: 75 }), source: src("a", 1) },
      { verdict: verdict({ confidence: 72 }), source: src("b", 1) },
    ]
    const rows = corroborate("food-pairing", hits)
    expect(rows).toHaveLength(1) // same normalized title → one corroborated row
    expect(rows[0].status).toBe("active")
    expect(rows[0].supportN).toBe(2)
    expect(rows[0].confidence).toBeGreaterThanOrEqual(75) // corroboration bonus applied
  })

  it("a single TIER-1 source lands at SHADOW (compute + observe, don't yet serve)", () => {
    const rows = corroborate("food-pairing", [{ verdict: verdict({ confidence: 65 }), source: src("a", 1) }])
    expect(rows[0].status).toBe("shadow")
  })

  it("writes external_trend rows with an active window (recency self-retire) and never relaxes grounding", () => {
    const now = Date.parse("2026-06-24T00:00:00Z")
    const rows = corroborate("food-pairing", [{ verdict: verdict({ confidence: 90 }), source: src("a", 1) }, { verdict: verdict({ confidence: 88 }), source: src("b", 1) }], { nowMs: now })
    expect(rows[0].effectiveToMs).toBeGreaterThan(rows[0].effectiveFromMs)
    expect(rows[0].provenance.streams).toEqual(["external"])
    // the row carries NO evidenceRefs field — a trend can never become a citable ref.
    expect("evidenceRefs" in rows[0]).toBe(false)
  })
})

describe("parseRssItems — dependency-free feed parsing", () => {
  it("extracts title + description + link from RSS items", () => {
    const xml = `<rss><channel>
      <item><title>Trend A</title><description>Body A</description><link>https://x/a</link></item>
      <item><title>Trend B</title><description><![CDATA[Body B & more]]></description><link>https://x/b</link></item>
    </channel></rss>`
    const items = parseRssItems(xml)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ title: "Trend A", body: "Body A", url: "https://x/a" })
    expect(items[1].body).toBe("Body B & more")
  })
})
