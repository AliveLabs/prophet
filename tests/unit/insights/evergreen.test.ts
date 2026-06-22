// P7a — cross-day dismissal cooldown. Tests the evergreen cooldown module (mock client) and that
// synthesize() actually suppresses cooled-down plays.

import { describe, it, expect } from "vitest"
import {
  recordDismissalCooldown,
  clearDismissalCooldown,
  loadActiveCooldowns,
  saveEvergreenPlay,
  removeEvergreenPlay,
  loadEvergreenPlays,
  DEFAULT_COOLDOWN_DAYS,
} from "@/lib/insights/evergreen"
import { synthesize } from "@/lib/skills/synthesis"
import { playKey } from "@/lib/skills/preferences"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { SkillResult } from "@/lib/skills/skill-types"
import type { Transport } from "@/lib/ai/provider"

const NOW = Date.parse("2026-06-22T12:00:00Z")

// Minimal mock of the loose EvergreenStore surface, capturing what was written.
function mockClient(opts: { rows?: { play_key: string }[]; selectError?: boolean } = {}) {
  const calls = { upserts: [] as { row: Record<string, unknown>; onConflict: string }[], deletes: [] as string[][], gt: [] as [string, string][] }
  const client = {
    from: () => ({
      upsert: async (row: Record<string, unknown>, o: { onConflict: string }) => {
        calls.upserts.push({ row, onConflict: o.onConflict })
        return { error: null }
      },
      delete: () => ({
        eq: (c: string, v: string) => ({
          eq: async (c2: string, v2: string) => {
            calls.deletes.push([c, v, c2, v2])
            return { error: null }
          },
        }),
      }),
      select: () => ({
        eq: () => ({
          gt: async (c2: string, v2: string) => {
            calls.gt.push([c2, v2])
            return opts.selectError ? { data: null, error: { message: "relation does not exist" } } : { data: opts.rows ?? [], error: null }
          },
        }),
      }),
    }),
  }
  return { client: client as never, calls }
}

describe("evergreen cooldown module", () => {
  it("records a dismissal with expires_at = now + cooldown days, conflict on (location, play_key)", async () => {
    const { client, calls } = mockClient()
    await recordDismissalCooldown("loc1", "marketing:post-more", { client, nowMs: NOW })
    expect(calls.upserts).toHaveLength(1)
    const { row, onConflict } = calls.upserts[0]
    expect(row.location_id).toBe("loc1")
    expect(row.play_key).toBe("marketing:post-more")
    expect(onConflict).toBe("location_id,play_key")
    expect(row.expires_at).toBe(new Date(NOW + DEFAULT_COOLDOWN_DAYS * 86_400_000).toISOString())
  })

  it("loadActiveCooldowns returns the set of cooled-down playKeys", async () => {
    const { client } = mockClient({ rows: [{ play_key: "a" }, { play_key: "b" }] })
    const set = await loadActiveCooldowns("loc1", { client, nowMs: NOW })
    expect(set).toEqual(new Set(["a", "b"]))
  })

  it("loadActiveCooldowns FAILS SOFT to an empty set (e.g. table not migrated) — never breaks a build", async () => {
    const { client } = mockClient({ selectError: true })
    expect(await loadActiveCooldowns("loc1", { client, nowMs: NOW })).toEqual(new Set())
  })

  it("clearDismissalCooldown deletes the (location, play_key) row", async () => {
    const { client, calls } = mockClient()
    await clearDismissalCooldown("loc1", "marketing:post-more", { client })
    expect(calls.deletes[0]).toEqual(["location_id", "loc1", "play_key", "marketing:post-more"])
  })
})

describe("synthesize() honors suppressedKeys (P7a)", () => {
  const mkPlay = (over: Partial<EnrichedRecommendation>): EnrichedRecommendation => ({
    title: "t",
    rationale: "r",
    skillId: "marketing",
    ownerRole: "marketing",
    kind: "capitalize",
    recipe: [{ channel: "c", platforms: [], audience: "a", window: { note: "this week" } }],
    confidence: "medium",
    leverage: { label: "medium", basisInternal: "b" },
    evidenceRefs: ["social.posting_frequency_gap"],
    knowledgeVersion: "marketing@v1",
    ...over,
  })
  const failing: Transport = async () => {
    throw new Error("model down")
  }

  it("drops a play whose playKey is in cooldown, keeps the rest", async () => {
    const dismissed = mkPlay({ title: "Post more behind the scenes", evidenceRefs: ["social.behind_scenes_opportunity"] })
    const kept = mkPlay({ title: "Run a weekend promo", evidenceRefs: ["events.weekend_density_spike"] })
    const results: SkillResult[] = [{ skillId: "marketing", status: "ok", plays: [dismissed, kept] }]

    const brief = await synthesize(competitiveWeekDossier, results, {
      transport: failing,
      suppressedKeys: new Set([playKey(dismissed)]),
    })
    const keys = brief.plays.map((p) => playKey(p))
    expect(keys).not.toContain(playKey(dismissed))
    expect(keys).toContain(playKey(kept))
  })

  it("suppresses a dismissed FUSED play by its stableKey, not its (re-worded) title (major #1)", async () => {
    // Two producer plays that cluster (same kind + lead ref, 2 distinct skills). With the failing
    // transport, fusion collapses them to a keep-best play carrying the cluster's deterministic
    // stableKey. Dismissing that stableKey must drop it — even though neither producer's title-key,
    // nor a future re-fused title, equals the stableKey.
    const pA = mkPlay({ skillId: "marketing", title: "Post behind the scenes", evidenceRefs: ["social.behind_scenes_opportunity"] })
    const pB = mkPlay({ skillId: "guerrilla-marketing", title: "Seed word of mouth", evidenceRefs: ["social.behind_scenes_opportunity"] })
    const results: SkillResult[] = [{ skillId: "x", status: "ok", plays: [pA, pB] }]
    const stableKey = "fused:capitalize|social.behind_scenes_opportunity"

    // Sanity: without suppression the collapsed cluster surfaces as one play carrying the stableKey.
    const open = await synthesize(competitiveWeekDossier, results, { transport: failing })
    expect(open.plays).toHaveLength(1)
    expect(playKey(open.plays[0])).toBe(stableKey)

    // Suppressing by the stableKey drops it.
    const suppressed = await synthesize(competitiveWeekDossier, results, { transport: failing, suppressedKeys: new Set([stableKey]) })
    expect(suppressed.plays).toEqual([])
  })

  it("returns a quiet brief when every candidate is suppressed", async () => {
    const a = mkPlay({ title: "A", evidenceRefs: ["social.behind_scenes_opportunity"] })
    const b = mkPlay({ title: "B", evidenceRefs: ["events.weekend_density_spike"] })
    const results: SkillResult[] = [{ skillId: "marketing", status: "ok", plays: [a, b] }]
    const brief = await synthesize(competitiveWeekDossier, results, {
      transport: failing,
      suppressedKeys: new Set([playKey(a), playKey(b)]),
    })
    expect(brief.plays).toEqual([])
  })
})

// ── P7b: evergreen_plays persist + resurface ──────────────────────────────────────────────────

const mkRec = (over: Partial<EnrichedRecommendation>): EnrichedRecommendation => ({
  title: "t",
  rationale: "r",
  skillId: "marketing",
  ownerRole: "marketing",
  kind: "capitalize",
  recipe: [{ channel: "c", platforms: [], audience: "a", window: { note: "this week" } }],
  confidence: "medium",
  leverage: { label: "medium", basisInternal: "b" },
  evidenceRefs: ["social.behind_scenes_opportunity"],
  knowledgeVersion: "marketing@v1",
  ...over,
})

function mockPlaysClient(opts: { rows?: { play: unknown }[]; selectError?: boolean } = {}) {
  const calls = { upserts: [] as { row: Record<string, unknown>; onConflict: string }[], deletes: [] as string[][] }
  const client = {
    from: () => ({
      upsert: async (row: Record<string, unknown>, o: { onConflict: string }) => {
        calls.upserts.push({ row, onConflict: o.onConflict })
        return { error: null }
      },
      delete: () => ({
        eq: (c: string, v: string) => ({
          eq: async (c2: string, v2: string) => {
            calls.deletes.push([c, v, c2, v2])
            return { error: null }
          },
        }),
      }),
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () =>
              opts.selectError ? { data: null, error: { message: "relation does not exist" } } : { data: opts.rows ?? [], error: null },
          }),
        }),
      }),
    }),
  }
  return { client: client as never, calls }
}

describe("evergreen_plays persist module", () => {
  it("saveEvergreenPlay upserts the full play keyed by playKey", async () => {
    const { client, calls } = mockPlaysClient()
    const play = mkRec({ skillId: "operations", title: "Staff to the lunch curve", kind: "ops" })
    await saveEvergreenPlay("loc1", play, { client })
    expect(calls.upserts).toHaveLength(1)
    const { row, onConflict } = calls.upserts[0]
    expect(onConflict).toBe("location_id,play_key")
    expect(row.location_id).toBe("loc1")
    expect(row.play_key).toBe(playKey(play))
    expect(row.play).toBe(play)
  })

  it("loadEvergreenPlays returns persisted plays, and FAILS SOFT to [] on error", async () => {
    const p = mkRec({ title: "Saved one" })
    const ok = mockPlaysClient({ rows: [{ play: p }] })
    expect(await loadEvergreenPlays("loc1", { client: ok.client })).toEqual([p])
    const bad = mockPlaysClient({ selectError: true })
    expect(await loadEvergreenPlays("loc1", { client: bad.client })).toEqual([])
  })

  it("removeEvergreenPlay deletes the (location, play_key) row", async () => {
    const { client, calls } = mockPlaysClient()
    await removeEvergreenPlay("loc1", "marketing:saved-one", { client })
    expect(calls.deletes[0]).toEqual(["location_id", "loc1", "play_key", "marketing:saved-one"])
  })
})

describe("synthesize() resurfaces evergreen plays (P7b)", () => {
  const failing: Transport = async () => {
    throw new Error("model down")
  }
  const sig = (insight_type: string): GeneratedInsight => ({
    insight_type,
    title: "",
    summary: "",
    confidence: "medium",
    severity: "info",
    evidence: {},
    recommendations: [],
  })
  const dossierWith = (refs: string[]): Dossier => ({ ...competitiveWeekDossier, ruleOutputs: refs.map(sig) })

  it("resurfaces a relevant STANDING saved play; skips one whose grounding is gone", async () => {
    const d = dossierWith(["social.behind_scenes_opportunity"]) // only this ref resolves today
    const fresh = mkRec({ skillId: "marketing", title: "Fresh", evidenceRefs: ["social.behind_scenes_opportunity"] })
    const relevant = mkRec({ skillId: "positioning", kind: "positioning", title: "Saved relevant", evidenceRefs: ["social.behind_scenes_opportunity"] })
    const stale = mkRec({ skillId: "operations", kind: "ops", title: "Saved stale", evidenceRefs: ["events.long_gone"] })
    const brief = await synthesize(d, [{ skillId: "marketing", status: "ok", plays: [fresh] }], {
      transport: failing,
      evergreen: [relevant, stale],
    })
    const keys = brief.plays.map(playKey)
    expect(keys).toContain(playKey(fresh))
    expect(keys).toContain(playKey(relevant))
    expect(keys).not.toContain(playKey(stale))
  })

  it("does NOT resurface a time-bound (capitalize) saved play even when its grounding resolves (#1)", async () => {
    const d = dossierWith(["social.behind_scenes_opportunity"])
    const dated = mkRec({ skillId: "local-demand", kind: "capitalize", title: "Staff up for Sat Jun 14", evidenceRefs: ["social.behind_scenes_opportunity"] })
    const brief = await synthesize(d, [{ skillId: "marketing", status: "ok", plays: [] }], { transport: failing, evergreen: [dated] })
    expect(brief.plays.map(playKey)).not.toContain(playKey(dated))
  })

  it("does not duplicate an evergreen play already produced today", async () => {
    const d = dossierWith(["social.behind_scenes_opportunity"])
    const p = mkRec({ skillId: "operations", kind: "ops", title: "Same play", evidenceRefs: ["social.behind_scenes_opportunity"] })
    const brief = await synthesize(d, [{ skillId: "operations", status: "ok", plays: [p] }], {
      transport: failing,
      evergreen: [{ ...p }], // same playKey as the produced play
    })
    expect(brief.plays.filter((x) => playKey(x) === playKey(p))).toHaveLength(1)
  })

  it("resurfaces a relevant standing play even on a quiet day (no fresh candidates)", async () => {
    const d = dossierWith(["social.behind_scenes_opportunity"])
    const saved = mkRec({ skillId: "reputation", kind: "reputation", title: "Standing advice", evidenceRefs: ["social.behind_scenes_opportunity"] })
    const brief = await synthesize(d, [{ skillId: "marketing", status: "ok", plays: [] }], { transport: failing, evergreen: [saved] })
    expect(brief.plays.map(playKey)).toContain(playKey(saved))
  })

  it("when over the cap, resurfaces the HIGHEST-scored standing plays (not arbitrary order) (#3)", async () => {
    const d = dossierWith(["social.behind_scenes_opportunity"])
    const strong = [0, 1, 2].map((i) =>
      mkRec({ skillId: "operations", kind: "ops", confidence: "high", title: `Strong ${i}`, evidenceRefs: ["social.behind_scenes_opportunity"] }),
    )
    const weak = mkRec({ skillId: "operations", kind: "ops", confidence: "directional", title: "Weak", evidenceRefs: ["social.behind_scenes_opportunity"] })
    // weak listed FIRST — an unordered slice(0,3) would keep it; score-ordering must drop it.
    const brief = await synthesize(d, [{ skillId: "marketing", status: "ok", plays: [] }], {
      transport: failing,
      evergreen: [weak, ...strong],
      maxPlays: 50,
    })
    const titles = brief.plays.map((p) => p.title)
    expect(titles.filter((t) => t.startsWith("Strong"))).toHaveLength(3)
    expect(titles).not.toContain("Weak")
  })
})
