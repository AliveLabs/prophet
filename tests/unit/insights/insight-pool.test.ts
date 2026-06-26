import { describe, it, expect } from "vitest"
import { updateInsightPool, type PoolStore } from "@/lib/insights/insight-pool"
import type { EnrichedRecommendation } from "@/lib/skills/types"

// Minimal in-memory mock of the loose PoolStore surface (upsert / select.eq.order /
// update.eq[.eq] / delete.lt.eq), enough to exercise updateInsightPool's top-N recompute.
function makeMock() {
  const rows: Record<string, unknown>[] = []
  const store: PoolStore = {
    from() {
      return {
        upsert(newRows: Record<string, unknown>[]) {
          for (const r of newRows) {
            const i = rows.findIndex((x) => x.location_id === r.location_id && x.play_key === r.play_key)
            if (i >= 0) rows[i] = { ...rows[i], ...r }
            else rows.push({ ...r })
          }
          return Promise.resolve({ error: null })
        },
        select() {
          return {
            eq(_c: string, locId: string) {
              return {
                order(col: string, { ascending }: { ascending: boolean }) {
                  const out = rows
                    .filter((x) => x.location_id === locId)
                    .sort((a, b) => (ascending ? 1 : -1) * ((a[col] as number) - (b[col] as number)))
                  return Promise.resolve({ data: out, error: null })
                },
              }
            },
          }
        },
        update(vals: Record<string, unknown>) {
          return {
            eq(c1: string, v1: string) {
              const p = {
                then(resolve: (r: { error: null }) => void) {
                  for (const x of rows) if (x[c1] === v1) Object.assign(x, vals)
                  resolve({ error: null })
                },
                eq(c2: string, v2: string) {
                  for (const x of rows) if (x[c1] === v1 && x[c2] === v2) Object.assign(x, vals)
                  return Promise.resolve({ error: null })
                },
              }
              return p as unknown as Promise<{ error: null }> & { eq: (c2: string, v2: string) => Promise<{ error: null }> }
            },
          }
        },
        delete() {
          return { lt: () => ({ eq: () => Promise.resolve({ error: null }) }) }
        },
      }
    },
  }
  return { store, rows }
}

function play(title: string, score: number, category: string): EnrichedRecommendation {
  return {
    title,
    rationale: "why",
    skillId: category, // playKey = skillId + title-slug, so keys read as `${category}:${slug}`
    kind: "capitalize",
    category,
    confidence: "high",
    combinedScore: score,
    evidenceRefs: [],
    recipe: [],
  } as unknown as EnrichedRecommendation
}

describe("updateInsightPool", () => {
  it("flags exactly the top-N by combined_score as is_top", async () => {
    const { store, rows } = makeMock()
    const plays = Array.from({ length: 9 }, (_, i) => play(`Play ${i}`, 90 - i * 10, "convergence"))
    await updateInsightPool("loc-1", plays, "2026-06-26", { client: store, topMax: 7, nowMs: 1_000_000_000_000 })

    const top = rows.filter((r) => r.is_top === true)
    expect(top).toHaveLength(7)
    // The two lowest scores (10, 20) are pushed OUT of top.
    const topTitles = top.map((r) => r.play_key)
    expect(rows).toHaveLength(9) // all 9 retained in the pool (available via "see all")
    expect(topTitles).not.toContain("convergence:play-8") // score 10
    expect(topTitles).not.toContain("convergence:play-7") // score 20
  })

  it("is idempotent + re-ranks on re-run (a re-appearing play refreshes, no duplicate)", async () => {
    const { store, rows } = makeMock()
    await updateInsightPool("loc-1", [play("Alpha", 50, "menu")], "2026-06-26", { client: store, nowMs: 1_000_000_000_000 })
    // Re-run with a higher score + a new play.
    await updateInsightPool("loc-1", [play("Alpha", 95, "menu"), play("Beta", 80, "social")], "2026-06-27", {
      client: store,
      nowMs: 1_000_086_400_000,
    })
    expect(rows).toHaveLength(2) // Alpha de-duped on play_key, Beta added
    const alpha = rows.find((r) => r.play_key === "menu:alpha")
    expect(alpha?.combined_score).toBe(95) // refreshed
    expect(alpha?.last_seen_date).toBe("2026-06-27")
    expect(rows.filter((r) => r.is_top).length).toBe(2)
  })

  it("does nothing for an empty play list", async () => {
    const { store, rows } = makeMock()
    await updateInsightPool("loc-1", [], "2026-06-26", { client: store })
    expect(rows).toHaveLength(0)
  })
})
