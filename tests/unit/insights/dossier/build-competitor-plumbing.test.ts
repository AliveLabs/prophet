// T3 + T4 — competitor busyTimes / review-sentiment plumbing in buildDossier's
// competitor-assembly block (lib/insights/dossier/build.ts ~479-493 pre-change).
//
// T3: loadCompetitorBusyTimes reads STORED `busy_times` rows (written by the traffic
// pipeline on its own cadence) and groups them into BusyTimesResult per competitor —
// never a live per-competitor Outscraper call.
// T4: themesFromReviewThemesEvidence reshapes a stored `review_themes` insight row's
// evidence.themes (written by the insights pipeline's narrative pass, ZERO new model
// calls) into EntitySignals.reviews' ReviewSentiment["themes"] shape.

import { describe, it, expect, vi } from "vitest"
import { loadCompetitorBusyTimes, themesFromReviewThemesEvidence } from "@/lib/insights/dossier/build"

describe("T3 — loadCompetitorBusyTimes", () => {
  it("returns an empty map for an empty competitor id list (no query issued)", async () => {
    const sb = { from: vi.fn() } as unknown as Parameters<typeof loadCompetitorBusyTimes>[0]
    const out = await loadCompetitorBusyTimes(sb, [])
    expect(out.size).toBe(0)
    expect(sb.from).not.toHaveBeenCalled()
  })

  it("groups stored rows into a BusyTimesResult per competitor, fail-soft null omission", async () => {
    const rows = [
      { competitor_id: "comp-1", day_of_week: 1, hourly_scores: Array(24).fill(10), peak_hour: 12, peak_score: 80, slow_hours: [2, 3], typical_time_spent: "45 min", current_popularity: 55 },
      { competitor_id: "comp-1", day_of_week: 2, hourly_scores: Array(24).fill(5), peak_hour: 13, peak_score: 70, slow_hours: [1], typical_time_spent: "45 min", current_popularity: 55 },
    ]
    const orderMock = vi.fn().mockResolvedValue({ data: rows, error: null })
    const inMock = vi.fn().mockReturnValue({ order: orderMock })
    const selectMock = vi.fn().mockReturnValue({ in: inMock })
    const fromMock = vi.fn().mockReturnValue({ select: selectMock })
    const sb = { from: fromMock } as unknown as Parameters<typeof loadCompetitorBusyTimes>[0]

    const out = await loadCompetitorBusyTimes(sb, ["comp-1", "comp-2"])
    expect(fromMock).toHaveBeenCalledWith("busy_times")
    expect(inMock).toHaveBeenCalledWith("competitor_id", ["comp-1", "comp-2"])
    // comp-1 present with both days; comp-2 absent entirely (no stored rows) — the caller
    // maps this to `busyTimes: null` for comp-2, never a fabricated/empty shell.
    expect(out.has("comp-2")).toBe(false)
    const comp1 = out.get("comp-1")
    expect(comp1?.competitor_id).toBe("comp-1")
    expect(comp1?.days).toHaveLength(2)
    expect(comp1?.days.map((d) => d.day_of_week).sort()).toEqual([1, 2])
    expect(comp1?.working_hours_lines).toBeNull() // not persisted on this table (ALT-264 caches it elsewhere)
  })

  it("returns an empty map (not a throw) on a query error", async () => {
    const orderMock = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } })
    const inMock = vi.fn().mockReturnValue({ order: orderMock })
    const selectMock = vi.fn().mockReturnValue({ in: inMock })
    const fromMock = vi.fn().mockReturnValue({ select: selectMock })
    const sb = { from: fromMock } as unknown as Parameters<typeof loadCompetitorBusyTimes>[0]

    const out = await loadCompetitorBusyTimes(sb, ["comp-1"])
    expect(out.size).toBe(0)
  })
})

describe("T4 — themesFromReviewThemesEvidence", () => {
  it("maps a well-formed review_themes evidence payload", () => {
    const evidence = {
      themes: [
        { theme: "slow service", sentiment: "negative", mentions: 6, examples: ["Waited forty minutes."] },
        { theme: "friendly staff", sentiment: "positive", mentions: 12, examples: ["Everyone was so kind."] },
      ],
    }
    const themes = themesFromReviewThemesEvidence(evidence)
    expect(themes).toHaveLength(2)
    expect(themes[0]).toEqual({ theme: "slow service", sentiment: "negative", mentions: 6, examples: ["Waited forty minutes."] })
  })

  it("falls back to 'mixed' for an unrecognized sentiment and 0 mentions when absent", () => {
    const themes = themesFromReviewThemesEvidence({ themes: [{ theme: "parking", sentiment: "weird", examples: [] }] })
    expect(themes[0]?.sentiment).toBe("mixed")
    expect(themes[0]?.mentions).toBe(0)
  })

  it("accepts a singular 'example' field (reputation@v2's own competitorField shape) as a fallback", () => {
    const themes = themesFromReviewThemesEvidence({ themes: [{ theme: "wait times", sentiment: "negative", mentions: 3, example: "Only one entrée." }] })
    expect(themes[0]?.examples).toEqual(["Only one entrée."])
  })

  it("returns [] for absent/malformed evidence — fail-soft, never throws", () => {
    expect(themesFromReviewThemesEvidence(null)).toEqual([])
    expect(themesFromReviewThemesEvidence(undefined)).toEqual([])
    expect(themesFromReviewThemesEvidence({})).toEqual([])
    expect(themesFromReviewThemesEvidence({ themes: "not-an-array" })).toEqual([])
  })
})
