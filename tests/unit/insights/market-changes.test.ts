import { describe, it, expect } from "vitest"
import {
  buildCompetitorChangelog,
  changelogWindowStart,
  CHANGELOG_LIMIT,
  CHANGELOG_WINDOW_DAYS,
  type ChangeRow,
  type TrackedCompetitor,
} from "@/lib/insights/market-changes"

const COMPS: TrackedCompetitor[] = [
  { id: "c1", name: "Fog Harbor" },
  { id: "c2", name: "Bert's" },
  { id: "c3", name: "Wagyu House" },
]

let seq = 0
function row(over: Partial<ChangeRow> = {}): ChangeRow {
  seq += 1
  return {
    id: `r${seq}`,
    competitorId: "c1",
    insightType: "hours_changed",
    dateKey: "2026-08-13",
    createdAt: "2026-08-13T09:00:00Z",
    evidence: {},
    ...over,
  }
}

describe("buildCompetitorChangelog — what counts as a change", () => {
  it("renders a real diff, named, dated, in plain language", () => {
    const entries = buildCompetitorChangelog([row({ insightType: "hours_changed" })], COMPS)
    expect(entries).toEqual([
      {
        id: entries[0].id,
        competitorId: "c1",
        competitorName: "Fog Harbor",
        kind: "hours",
        what: "Changed their posted hours",
        dateKey: "2026-08-13",
      },
    ])
  })

  it("DROPS the pipeline's two filler types — an honest absence beats a padded list", () => {
    const rows = [
      row({ insightType: "no_significant_change" }),
      row({ insightType: "baseline_snapshot" }),
    ]
    expect(buildCompetitorChangelog(rows, COMPS)).toEqual([])
  })

  it("drops advisory rows, so the list stays a changelog and not a second insight feed", () => {
    const rows = [
      row({ insightType: "menu.category_gap" }),
      row({ insightType: "menu.price_positioning_shift" }),
      row({ insightType: "menu.promo_signal_detected" }),
      row({ insightType: "seo_keyword_opportunity_gap" }),
      row({ insightType: "competitive_summary" }),
      row({ insightType: "review_themes" }),
    ]
    expect(buildCompetitorChangelog(rows, COMPS)).toEqual([])
  })

  it("works from an allowlist: an insight_type nobody has admitted never renders as a change", () => {
    expect(buildCompetitorChangelog([row({ insightType: "some.future_rule" })], COMPS)).toEqual([])
  })

  it("covers every change family the pipelines actually write", () => {
    const rows = [
      row({ competitorId: "c1", insightType: "rating_change", evidence: { delta: -0.2 } }),
      row({ competitorId: "c1", insightType: "review_velocity_rising", evidence: { delta: 7 } }),
      row({ competitorId: "c1", insightType: "photo.new_content", evidence: { added_count: 4 } }),
      row({ competitorId: "c1", insightType: "photo.price_change", evidence: { detected_price: "$12.99" } }),
      row({ competitorId: "c1", insightType: "photo.promotion_detected" }),
      row({ competitorId: "c1", insightType: "seo_competitor_overtake", evidence: { keyword: "bbq near me" } }),
      row({ competitorId: "c1", insightType: "hours_changed" }),
    ]
    const kinds = buildCompetitorChangelog(rows, COMPS, { limit: 20 }).map((e) => e.kind)
    expect(new Set(kinds)).toEqual(new Set(["rating", "reviews", "photos", "pricing", "promo", "search", "hours"]))
  })
})

describe("buildCompetitorChangelog — denominated copy from stored evidence", () => {
  const cases: Array<[string, unknown, string]> = [
    ["rating_change", { delta: 0.2 }, "Rating moved up 0.2"],
    ["rating_change", { delta: -0.3 }, "Rating moved down 0.3"],
    ["weekly_rating_trend", { delta: -0.4 }, "Rating moved down 0.4 over the week"],
    ["review_velocity_rising", { delta: 7 }, "Picked up 7 reviews"],
    ["review_velocity_rising", { delta: 1 }, "Picked up a review"],
    ["review_velocity_falling", { delta: -3 }, "Lost 3 reviews"],
    ["weekly_review_trend", { delta: 9 }, "Review count up 9 over the week"],
    ["photo.new_content", { added_count: 4 }, "Added 4 photos"],
    ["photo.new_content", { added_count: 1 }, "Added a photo"],
    ["photo.content_removed", { removed_count: 3 }, "Removed 3 photos"],
    ["photo.price_change", { detected_price: "$12.99" }, "Posted a price in a new photo: $12.99"],
    ["seo_competitor_overtake", { keyword: "bbq near me" }, 'Moved ahead of you in search for "bbq near me"'],
    ["social.competitor_promo_blitz", { promotionalPct: 42, platform: "instagram" }, "Promotions in 42% of their recent posts on Instagram"],
    ["social.competitor_promo_blitz", { promotionalPct: 31, platform: "tiktok" }, "Promotions in 31% of their recent posts on TikTok"],
  ]

  for (const [insightType, evidence, expected] of cases) {
    it(`${insightType} reads "${expected}"`, () => {
      const [entry] = buildCompetitorChangelog([row({ insightType, evidence })], COMPS)
      expect(entry.what).toBe(expected)
    })
  }

  it("NEVER guesses a number: missing evidence degrades to a truthful number-free phrase", () => {
    const rows = [
      row({ competitorId: "c1", insightType: "rating_change", evidence: {} }),
      row({ competitorId: "c2", insightType: "photo.new_content", evidence: {} }),
      row({ competitorId: "c3", insightType: "social.competitor_promo_blitz", evidence: {} }),
    ]
    const what = buildCompetitorChangelog(rows, COMPS, { limit: 20 }).map((e) => e.what)
    expect(what).toContain("Rating moved")
    expect(what).toContain("Added photos")
    expect(what).toContain("Pushing promotions hard")
    for (const line of what) expect(line).not.toMatch(/\d/)
  })

  it("survives evidence that is null or the wrong shape", () => {
    const rows = [
      row({ competitorId: "c1", insightType: "rating_change", evidence: null }),
      row({ competitorId: "c2", insightType: "photo.new_content", evidence: "nope" }),
      row({ competitorId: "c3", insightType: "photo.price_change", evidence: { detected_price: 12 } }),
    ]
    const entries = buildCompetitorChangelog(rows, COMPS, { limit: 20 })
    expect(entries).toHaveLength(3)
    for (const e of entries) expect(e.what.length).toBeGreaterThan(0)
  })
})

describe("buildCompetitorChangelog — attribution is mandatory", () => {
  it("resolves a NULL competitor_id from the name the rule left in evidence", () => {
    const rows = [row({ competitorId: null, insightType: "social.competitor_promo_blitz", evidence: { competitor: "Bert's", promotionalPct: 33, platform: "Instagram" } })]
    const [entry] = buildCompetitorChangelog(rows, COMPS)
    expect(entry.competitorId).toBe("c2")
    expect(entry.competitorName).toBe("Bert's")
  })

  it("matches evidence.competitor_name too, case- and whitespace-insensitively", () => {
    const rows = [row({ competitorId: null, insightType: "seo_competitor_overtake", evidence: { competitor_name: "  wagyu HOUSE ", keyword: "steak" } })]
    expect(buildCompetitorChangelog(rows, COMPS)[0]?.competitorId).toBe("c3")
  })

  it("DROPS a row it cannot name — never renders an anonymous 'a competitor'", () => {
    const rows = [
      row({ competitorId: null, insightType: "hours_changed", evidence: {} }),
      row({ competitorId: null, insightType: "seo_competitor_overtake", evidence: { competitor_name: "Somebody Else", keyword: "k" } }),
    ]
    expect(buildCompetitorChangelog(rows, COMPS)).toEqual([])
  })

  it("drops a row whose competitor is no longer tracked", () => {
    expect(buildCompetitorChangelog([row({ competitorId: "gone" })], COMPS)).toEqual([])
  })

  it("shows the operator's display label, since that is the name they gave the competitor", () => {
    const relabelled: TrackedCompetitor[] = [{ id: "c1", name: "The place on 5th" }]
    const [entry] = buildCompetitorChangelog([row({ competitorId: "c1" })], relabelled)
    expect(entry.competitorName).toBe("The place on 5th")
  })

  it("still matches a RELABELLED competitor by its canonical name, but renders the label", () => {
    const relabelled: TrackedCompetitor[] = [{ id: "c1", name: "The place on 5th", aliases: ["Fog Harbor"] }]
    const rows = [row({ competitorId: null, insightType: "hours_changed", evidence: { competitor: "Fog Harbor" } })]
    const [entry] = buildCompetitorChangelog(rows, relabelled)
    expect(entry.competitorId).toBe("c1")
    expect(entry.competitorName).toBe("The place on 5th")
  })

  it("an alias never steals the name another competitor is shown under", () => {
    const set: TrackedCompetitor[] = [
      { id: "c1", name: "Corner Grill", aliases: ["Bert's"] },
      { id: "c2", name: "Bert's" },
    ]
    const rows = [row({ competitorId: null, insightType: "hours_changed", evidence: { competitor: "Bert's" } })]
    expect(buildCompetitorChangelog(rows, set)[0]?.competitorId).toBe("c2")
  })
})

describe("buildCompetitorChangelog — dedup, order and cap", () => {
  it("collapses the SAME change spotted by two pipelines into one line", () => {
    const rows = [
      row({ competitorId: "c1", insightType: "photo.promotion_detected", dateKey: "2026-08-12" }),
      row({ competitorId: "c1", insightType: "social.competitor_promo_blitz", dateKey: "2026-08-11", evidence: { promotionalPct: 40 } }),
    ]
    const entries = buildCompetitorChangelog(rows, COMPS)
    expect(entries).toHaveLength(1)
    expect(entries[0].dateKey).toBe("2026-08-12")
  })

  it("collapses a rating that moved on several days into its newest read", () => {
    const rows = [
      row({ competitorId: "c1", insightType: "rating_change", dateKey: "2026-08-09", evidence: { delta: 0.1 } }),
      row({ competitorId: "c1", insightType: "weekly_rating_trend", dateKey: "2026-08-13", evidence: { delta: 0.3 } }),
      row({ competitorId: "c1", insightType: "rating_change", dateKey: "2026-08-11", evidence: { delta: 0.2 } }),
    ]
    const entries = buildCompetitorChangelog(rows, COMPS)
    expect(entries).toEqual([expect.objectContaining({ dateKey: "2026-08-13", what: "Rating moved up 0.3 over the week" })])
  })

  it("keeps the SAME family for DIFFERENT competitors — dedup is per competitor", () => {
    const rows = [
      row({ competitorId: "c1", insightType: "hours_changed" }),
      row({ competitorId: "c2", insightType: "hours_changed" }),
    ]
    expect(buildCompetitorChangelog(rows, COMPS)).toHaveLength(2)
  })

  it("orders newest first", () => {
    const rows = [
      row({ competitorId: "c1", insightType: "hours_changed", dateKey: "2026-08-08" }),
      row({ competitorId: "c2", insightType: "hours_changed", dateKey: "2026-08-13" }),
      row({ competitorId: "c3", insightType: "hours_changed", dateKey: "2026-08-10" }),
    ]
    expect(buildCompetitorChangelog(rows, COMPS).map((e) => e.dateKey)).toEqual([
      "2026-08-13",
      "2026-08-10",
      "2026-08-08",
    ])
  })

  it("is deterministic: the same rows in a different order yield the same list", () => {
    const rows = [
      row({ competitorId: "c1", insightType: "hours_changed", dateKey: "2026-08-13" }),
      row({ competitorId: "c2", insightType: "photo.new_content", dateKey: "2026-08-13", evidence: { added_count: 2 } }),
      row({ competitorId: "c3", insightType: "rating_change", dateKey: "2026-08-13", evidence: { delta: 0.2 } }),
    ]
    const forward = buildCompetitorChangelog(rows, COMPS)
    const reversed = buildCompetitorChangelog([...rows].reverse(), COMPS)
    expect(reversed).toEqual(forward)
  })

  it("caps the list rather than growing an uncapped page", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({
        competitorId: COMPS[i % 3].id,
        insightType: ["hours_changed", "photo.new_content", "rating_change", "seo_competitor_overtake"][i % 4],
        dateKey: `2026-08-${String(10 + (i % 4)).padStart(2, "0")}`,
        evidence: { added_count: 2, delta: 0.2, keyword: "k" },
      }),
    )
    expect(buildCompetitorChangelog(rows, COMPS).length).toBe(CHANGELOG_LIMIT)
    expect(buildCompetitorChangelog(rows, COMPS, { limit: 3 })).toHaveLength(3)
  })
})

describe("buildCompetitorChangelog — the empty cases", () => {
  it("returns nothing when the week produced nothing", () => {
    expect(buildCompetitorChangelog([], COMPS)).toEqual([])
  })

  it("returns nothing when no competitors are tracked", () => {
    expect(buildCompetitorChangelog([row()], [])).toEqual([])
  })

  it("returns nothing for a non-positive cap", () => {
    expect(buildCompetitorChangelog([row()], COMPS, { limit: 0 })).toEqual([])
  })
})

describe("changelogWindowStart", () => {
  it("is seven UTC days back, as a date_key", () => {
    expect(changelogWindowStart(new Date("2026-08-14T06:00:00Z"))).toBe("2026-08-07")
    expect(CHANGELOG_WINDOW_DAYS).toBe(7)
  })
})
