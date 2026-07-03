import { describe, it, expect } from "vitest"
import { diffSnapshots } from "@/lib/insights/diff"
import { buildInsights, buildOwnInsights } from "@/lib/insights/rules"
import { lintVoice } from "@/lib/eval/voice-rules"
import type { NormalizedSnapshot } from "@/lib/providers/types"

function snapshot(rating?: number, reviewCount?: number): NormalizedSnapshot {
  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    profile: { rating, reviewCount },
  } as NormalizedSnapshot
}

describe("buildOwnInsights — T5(a) own-location diff rows", () => {
  it("fires a rating_change row on a rating drop, entity-named, competitor_id implied null by caller", () => {
    const diff = diffSnapshots(snapshot(4.4, 100), snapshot(4.2, 100))
    const insights = buildOwnInsights(diff, "Joe's Diner")

    const rating = insights.find((i) => i.insight_type === "rating_change")
    expect(rating).toBeDefined()
    expect(rating!.severity).toBe("warning")
    expect(rating!.title.toLowerCase()).toContain("your rating")
    // entity named somewhere in title or summary
    expect(rating!.title + rating!.summary).toContain("Joe's Diner")
    expect(rating!.evidence).toMatchObject({ field: "rating", previous: 4.4, current: 4.2 })
    expect(typeof rating!.evidence.delta).toBe("number")
  })

  it("uses severity info for a positive rating change", () => {
    const diff = diffSnapshots(snapshot(4.2, 100), snapshot(4.5, 100))
    const insights = buildOwnInsights(diff, "Joe's Diner")
    const rating = insights.find((i) => i.insight_type === "rating_change")
    expect(rating).toBeDefined()
    expect(rating!.severity).toBe("info")
  })

  it("fires review_velocity_falling / rising rows, entity-named", () => {
    const fallingDiff = diffSnapshots(snapshot(4.4, 120), snapshot(4.4, 110))
    const falling = buildOwnInsights(fallingDiff, "Joe's Diner")
    const fallingRow = falling.find((i) => i.insight_type === "review_velocity_falling")
    expect(fallingRow).toBeDefined()
    expect(fallingRow!.severity).toBe("warning")
    expect(fallingRow!.title + fallingRow!.summary).toContain("Joe's Diner")
    expect(fallingRow!.evidence).toMatchObject({ field: "reviewCount", previous: 120, current: 110 })

    const risingDiff = diffSnapshots(snapshot(4.4, 100), snapshot(4.4, 115))
    const rising = buildOwnInsights(risingDiff, "Joe's Diner")
    const risingRow = rising.find((i) => i.insight_type === "review_velocity_rising")
    expect(risingRow).toBeDefined()
    expect(risingRow!.severity).toBe("info")
  })

  it("emits no rows when there is no previous snapshot (first-run / baseline)", () => {
    const diff = diffSnapshots(null, snapshot(4.4, 100))
    const insights = buildOwnInsights(diff, "Joe's Diner")
    expect(insights).toEqual([])
  })

  it("emits no rows when nothing meaningfully changed", () => {
    const diff = diffSnapshots(snapshot(4.4, 100), snapshot(4.4, 101))
    const insights = buildOwnInsights(diff, "Joe's Diner")
    expect(insights).toEqual([])
  })

  it("all generated titles pass lintVoice", () => {
    const diff = diffSnapshots(snapshot(4.6, 100), snapshot(4.1, 80))
    const insights = buildOwnInsights(diff, "Joe's Diner")
    expect(insights.length).toBeGreaterThan(0)
    for (const insight of insights) {
      expect(lintVoice(insight.title)).toEqual([])
      expect(lintVoice(insight.summary)).toEqual([])
    }
  })

  it("falls back to a generic name when locationName is empty", () => {
    const diff = diffSnapshots(snapshot(4.4, 100), snapshot(4.2, 100))
    const insights = buildOwnInsights(diff, "")
    const rating = insights.find((i) => i.insight_type === "rating_change")
    expect(rating!.summary).toContain("Your location")
  })
})

describe("buildInsights — competitor diff loop (unchanged, sanity)", () => {
  it("still emits rows without entity naming (mirrored, not replaced)", () => {
    const diff = diffSnapshots(snapshot(4.4, 100), snapshot(4.2, 100))
    const insights = buildInsights(diff)
    const rating = insights.find((i) => i.insight_type === "rating_change")
    expect(rating).toBeDefined()
    expect(rating!.title).toBe("Rating decreased")
  })
})
