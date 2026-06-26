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
  it("the latest brief's plays ARE the top; a prior play not in the new brief is demoted", async () => {
    const { store, rows } = makeMock()
    // Brief 1: A, B, C — all top.
    await updateInsightPool("loc-1", [play("A", 0, "convergence"), play("B", 0, "menu"), play("C", 0, "social")], "2026-06-26", {
      client: store,
      nowMs: 1_000_000_000_000,
    })
    expect(rows.filter((r) => r.is_top)).toHaveLength(3)
    // Brief 2: B (repeats) + D (new). A and C drop out of top but stay in the pool.
    await updateInsightPool("loc-1", [play("B", 0, "menu"), play("D", 0, "operations")], "2026-06-27", {
      client: store,
      nowMs: 1_000_086_400_000,
    })
    const topKeys = rows.filter((r) => r.is_top).map((r) => r.play_key).sort()
    expect(topKeys).toEqual(["menu:b", "operations:d"]) // exactly the latest brief
    expect(rows).toHaveLength(4) // A, B, C, D all retained (available via "see all")
    expect(rows.find((r) => r.play_key === "convergence:a")?.is_top).toBe(false) // demoted, still present
  })

  it("scores within-brief rank (rank-1 highest) for the see-all ordering", async () => {
    const { store, rows } = makeMock()
    await updateInsightPool("loc-1", [play("X", 0, "menu"), play("Y", 0, "social"), play("Z", 0, "operations")], "2026-06-26", {
      client: store,
      nowMs: 1_000_000_000_000,
    })
    expect(rows.find((r) => r.play_key === "menu:x")?.combined_score).toBe(3) // rank 1 of 3
    expect(rows.find((r) => r.play_key === "operations:z")?.combined_score).toBe(1) // rank 3
  })

  it("is idempotent — a re-appearing play refreshes recency, no duplicate", async () => {
    const { store, rows } = makeMock()
    await updateInsightPool("loc-1", [play("Alpha", 0, "menu")], "2026-06-26", { client: store, nowMs: 1_000_000_000_000 })
    await updateInsightPool("loc-1", [play("Beta", 0, "social"), play("Alpha", 0, "menu")], "2026-06-27", {
      client: store,
      nowMs: 1_000_086_400_000,
    })
    expect(rows).toHaveLength(2) // Alpha de-duped on play_key, Beta added
    const alpha = rows.find((r) => r.play_key === "menu:alpha")
    expect(alpha?.last_seen_date).toBe("2026-06-27") // refreshed
    expect(alpha?.is_top).toBe(true) // in the latest brief
  })

  it("does nothing for an empty play list", async () => {
    const { store, rows } = makeMock()
    await updateInsightPool("loc-1", [], "2026-06-26", { client: store })
    expect(rows).toHaveLength(0)
  })
})
