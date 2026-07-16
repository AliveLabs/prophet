// ALT-348/350 — the batched scoring pass, run against a stubbed transport and a
// mock store client (no live calls, no spend — same pattern as the skill tests).
// Pins: one batched call, strict validate/clamp/whitelist, the never-fabricate
// fallback (malformed output scores NOTHING), and the deterministic red-flag floor.

import { describe, it, expect } from "vitest"
import { scoreLocationReviews, REVIEW_SCORE_VERSION } from "@/lib/reviews/scoring"
import type { Transport } from "@/lib/ai/provider"
import type { LocationReviewRow } from "@/lib/reviews/types"

/** Minimal row factory — only the fields the scoring pass reads matter here. */
function rowWith(partial: Partial<LocationReviewRow> = {}): LocationReviewRow {
  return {
    id: "row-1",
    location_id: "loc-1",
    source: "google_places",
    source_review_id: "reviews/abc",
    author_name: "Pat",
    author_key: "name:pat",
    rating: 1,
    review_text: "Waited forever and the order was wrong.",
    published_at: "2026-07-01T12:00:00Z",
    relative_published: "2 weeks ago",
    google_maps_uri: null,
    first_seen_at: "2026-07-01T12:00:00Z",
    last_seen_at: "2026-07-15T12:00:00Z",
    authenticity_score: null,
    authenticity_confidence: null,
    authenticity_rationale: null,
    severity_score: null,
    severity_rationale: null,
    sentiment_score: null,
    red_flags: null,
    scored_at: null,
    score_version: null,
    triage_status: "open",
    triage_updated_at: null,
    operator_verdict: null,
    operator_verdict_at: null,
    draft_text: null,
    draft_generated_at: null,
    ...partial,
  }
}

/** Mock of the loose store surface: listUnscoredReviews' select chain + applyReviewScores'
 *  update chain (thenable, so the awaited builder resolves), capturing every write. */
function mockStore(rows: LocationReviewRow[]) {
  const updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          or: () => ({
            order: () => ({
              limit: async () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = []
        const chain = {
          eq(col: string, val: unknown) {
            filters.push([col, val])
            return chain
          },
          then(resolve: (v: { error: null }) => void) {
            updates.push({ patch, filters })
            resolve({ error: null })
          },
        }
        return chain
      },
    }),
  }
  return { client: client as never, updates }
}

const scoreEntry = (over: Record<string, unknown> = {}) => ({
  authenticityScore: 80,
  sentimentScore: -40,
  authenticityConfidence: "high",
  authenticityRationale: "Reads like a real visit.",
  severityScore: 40,
  severityRationale: "A serious but ordinary complaint.",
  redFlags: [],
  ...over,
})

describe("scoreLocationReviews", () => {
  it("no unscored rows -> zero work, transport never called", async () => {
    const { client, updates } = mockStore([])
    const transport: Transport = async () => {
      throw new Error("must not be called")
    }
    const result = await scoreLocationReviews(client, "loc-1", { transport })
    expect(result).toEqual({ scored: 0, errors: [] })
    expect(updates).toHaveLength(0)
  })

  it("happy path: ONE batched call; clamps, whitelists, coerces, drops phantom ids", async () => {
    const rows = [
      rowWith({ source_review_id: "reviews/a", review_text: "Slow service, wrong order.", rating: 1 }),
      rowWith({ id: "row-2", source_review_id: "reviews/b", review_text: "Great spot, friendly staff!", rating: 5 }),
    ]
    const { client, updates } = mockStore(rows)
    let calls = 0
    const transport: Transport = async (req) => {
      calls += 1
      // the batch prompt carries id/text/rating/publishedAt for EVERY row
      expect(req.prompt).toContain("reviews/a")
      expect(req.prompt).toContain("reviews/b")
      return {
        "reviews/a": scoreEntry({ authenticityScore: 87.6, severityScore: 55.2 }),
        // out-of-range scores, junk confidence, junk red-flag value — all sanitized
        "reviews/b": scoreEntry({
          authenticityScore: 120,
          authenticityConfidence: "very sure",
          severityScore: -5,
          redFlags: ["illness", "bogus_category"],
        }),
        // an id we never sent must be dropped, never written
        "reviews/ghost": scoreEntry(),
      }
    }
    const result = await scoreLocationReviews(client, "loc-1", { transport })
    expect(calls).toBe(1)
    expect(result.scored).toBe(2)
    expect(result.errors).toEqual([])
    expect(updates).toHaveLength(2)

    const a = updates.find((u) => u.filters.some(([c, v]) => c === "source_review_id" && v === "reviews/a"))
    expect(a?.patch.authenticity_score).toBe(88) // rounded to int
    expect(a?.patch.severity_score).toBe(55)
    expect(a?.patch.score_version).toBe(REVIEW_SCORE_VERSION)

    const b = updates.find((u) => u.filters.some(([c, v]) => c === "source_review_id" && v === "reviews/b"))
    expect(b?.patch.authenticity_score).toBe(100) // clamped
    expect(b?.patch.severity_score).toBe(0) // clamped
    expect(b?.patch.authenticity_confidence).toBe("low") // junk confidence degrades DOWN
    expect(b?.patch.red_flags).toEqual(["illness"]) // whitelist drops bogus values
  })

  it("deterministic red-flag phrase hit floors severity and adds the category", async () => {
    const rows = [rowWith({ source_review_id: "reviews/a", review_text: "We all got food poisoning after eating here.", rating: 1 })]
    const { client, updates } = mockStore(rows)
    const transport: Transport = async () => ({
      // the model under-reads the illness language — the deterministic pass must not
      "reviews/a": scoreEntry({ severityScore: 40, redFlags: [] }),
    })
    const result = await scoreLocationReviews(client, "loc-1", { transport })
    expect(result.scored).toBe(1)
    expect(updates[0].patch.severity_score).toBe(85)
    expect(updates[0].patch.red_flags).toEqual(["illness"])
  })

  it("deterministic check skips positive reviews (a 5-star quoting a phrase is not a crisis)", async () => {
    const rows = [rowWith({ source_review_id: "reviews/a", review_text: "The health department gave us an A. Spotless!", rating: 5 })]
    const { client, updates } = mockStore(rows)
    const transport: Transport = async () => ({
      "reviews/a": scoreEntry({ severityScore: 5, redFlags: [] }),
    })
    await scoreLocationReviews(client, "loc-1", { transport })
    expect(updates[0].patch.severity_score).toBe(5)
    expect(updates[0].patch.red_flags).toEqual([])
  })

  it("malformed model output scores NOTHING (rows stay unscored, loud error)", async () => {
    for (const bad of ["not json at all", [1, 2, 3], null]) {
      const { client, updates } = mockStore([rowWith()])
      const transport: Transport = async () => bad
      const result = await scoreLocationReviews(client, "loc-1", { transport })
      expect(result.scored).toBe(0)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(updates).toHaveLength(0)
    }
  })

  it("a throwing transport scores NOTHING (fallback path, loud error)", async () => {
    const { client, updates } = mockStore([rowWith()])
    const transport: Transport = async () => {
      throw new Error("model timed out")
    }
    const result = await scoreLocationReviews(client, "loc-1", { transport })
    expect(result.scored).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(updates).toHaveLength(0)
  })

  it("valid JSON with zero usable entries scores NOTHING and says so", async () => {
    const { client, updates } = mockStore([rowWith({ source_review_id: "reviews/a" })])
    const transport: Transport = async () => ({
      // scores are not numbers -> entry dropped (we never guess)
      "reviews/a": { authenticityScore: "high", severityScore: "bad" },
    })
    const result = await scoreLocationReviews(client, "loc-1", { transport })
    expect(result.scored).toBe(0)
    expect(result.errors.some((e) => e.includes("no usable entries"))).toBe(true)
    expect(updates).toHaveLength(0)
  })
})
