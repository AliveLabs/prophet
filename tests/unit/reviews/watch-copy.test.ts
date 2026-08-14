// Phase 4.2: the watchdog's operator-facing wording. Pure mapping, so these
// tests pin what an owner actually reads: the exact numbers, the voice rules the
// CI gate enforces, and the never-invent-a-figure posture (a row whose stored
// detail is unusable is DROPPED, never rendered with a guess).

import { describe, it, expect } from "vitest"
import { buildWatchNotice, buildWatchNotices, WATCH_COPY } from "@/lib/reviews/watch-copy"
import type { WatchEventRow } from "@/lib/reviews/watch-events"
import { lintVoice } from "@/lib/eval/voice-rules"

const row = (over: Partial<WatchEventRow> = {}): WatchEventRow => ({
  location_id: "loc-1",
  anomaly_key: "rating_move:down",
  kind: "rating_move",
  direction: "down",
  strength: 4.2,
  detail: { windowDays: 30, recentCount: 16, recentMean: 3.31, baselineCount: 180, baselineMean: 4.62, deltaStars: -1.31 },
  fired_on: "2026-08-14",
  cooldown_until: "2026-09-13T09:00:00Z",
  created_at: "2026-08-14T09:00:00Z",
  ...over,
})

const velocityRow = (over: Partial<WatchEventRow> = {}): WatchEventRow =>
  row({
    anomaly_key: "review_velocity:down",
    kind: "review_velocity",
    direction: "down",
    detail: { windowDays: 14, baselineDays: 180, recentCount: 1, expectedCount: 7.2, ratio: 0.14 },
    ...over,
  })

const clusterRow = (over: Partial<WatchEventRow> = {}): WatchEventRow =>
  row({
    anomaly_key: "red_flag_cluster:illness",
    kind: "red_flag_cluster",
    direction: "up",
    detail: { windowDays: 30, category: "illness", recentCount: 4, baselineExpected: 0 },
    ...over,
  })

describe("buildWatchNotice: rating movement", () => {
  it("states both averages and both counts, so the operator can check it themselves", () => {
    const view = buildWatchNotice(row())
    expect(view?.title).toBe(WATCH_COPY.ratingDown.title)
    expect(view?.tone).toBe("attention")
    expect(view?.line).toBe("Your last 16 reviews average 3.3 stars. Your usual is 4.6 across the 180 before them.")
    expect(view?.when).toBe("Aug 14")
  })

  it("reads as good news when the move is upward", () => {
    const view = buildWatchNotice(
      row({
        anomaly_key: "rating_move:up",
        direction: "up",
        detail: { windowDays: 30, recentCount: 20, recentMean: 4.8, baselineCount: 150, baselineMean: 3.3, deltaStars: 1.5 },
      }),
    )
    expect(view?.tone).toBe("good")
    expect(view?.title).toBe(WATCH_COPY.ratingUp.title)
  })

  it("never leaks the test statistic to the operator", () => {
    const view = buildWatchNotice(row({ strength: 7.77 }))
    expect(`${view?.title} ${view?.line}`).not.toContain("7.77")
  })
})

describe("buildWatchNotice: velocity", () => {
  it("compares the count to this location's own pace, rounded to a whole number", () => {
    const view = buildWatchNotice(velocityRow())
    expect(view?.title).toBe(WATCH_COPY.velocityDown.title)
    expect(view?.line).toBe("1 new review in the last 14 days. At your usual pace you would have about 7.")
  })

  it("never rounds an expectation down to zero", () => {
    const view = buildWatchNotice(
      velocityRow({ detail: { windowDays: 14, baselineDays: 180, recentCount: 0, expectedCount: 0.4, ratio: 0 } }),
    )
    expect(view?.line).toContain("about 1")
  })

  it("a burst reads as good news", () => {
    const view = buildWatchNotice(
      velocityRow({
        anomaly_key: "review_velocity:up",
        direction: "up",
        detail: { windowDays: 14, baselineDays: 180, recentCount: 18, expectedCount: 7, ratio: 2.57 },
      }),
    )
    expect(view?.tone).toBe("good")
    expect(view?.line).toBe("18 new reviews in the last 14 days. At your usual pace you would have about 7.")
  })
})

describe("buildWatchNotice: red-flag cluster", () => {
  it("names the theme in plain words and says it is rare here", () => {
    const view = buildWatchNotice(clusterRow())
    expect(view?.title).toBe(WATCH_COPY.cluster.illness)
    expect(view?.tone).toBe("attention")
    expect(view?.line).toBe(`4 reviews in the last 30 days raise this. ${WATCH_COPY.clusterRare}`)
  })

  it("says it is above the usual level when the theme does recur here", () => {
    const view = buildWatchNotice(
      clusterRow({ detail: { windowDays: 30, category: "food_safety", recentCount: 6, baselineExpected: 1.2 } }),
    )
    expect(view?.line).toContain(WATCH_COPY.clusterAboveUsual)
  })

  it("falls back to a neutral title for a category it does not have wording for", () => {
    const view = buildWatchNotice(
      clusterRow({ detail: { windowDays: 30, category: "brand_new_category", recentCount: 3, baselineExpected: 0 } }),
    )
    expect(view?.title).toBe(WATCH_COPY.cluster.fallback)
  })
})

describe("buildWatchNotice: never invents a number", () => {
  it("drops a row whose detail is missing a figure the line needs", () => {
    expect(buildWatchNotice(row({ detail: { windowDays: 30, recentCount: 16 } }))).toBeNull()
    expect(buildWatchNotice(velocityRow({ detail: {} }))).toBeNull()
    expect(buildWatchNotice(clusterRow({ detail: { windowDays: 30, recentCount: 3 } }))).toBeNull()
  })

  it("drops a row of an unrecognized kind", () => {
    expect(buildWatchNotice(row({ kind: "something_new" }))).toBeNull()
  })

  it("renders without a date rather than a wrong one", () => {
    expect(buildWatchNotice(row({ fired_on: "not a date" }))?.when).toBeNull()
  })
})

describe("buildWatchNotices", () => {
  it("leads with what needs attention, then the most recently flagged", () => {
    const views = buildWatchNotices([
      velocityRow({ anomaly_key: "review_velocity:up", direction: "up", fired_on: "2026-08-14" }),
      row({ fired_on: "2026-08-02" }),
      clusterRow({ fired_on: "2026-08-10" }),
    ])
    expect(views.map((v) => v.key)).toEqual([
      "red_flag_cluster:illness",
      "rating_move:down",
      "review_velocity:up",
    ])
  })

  it("skips unusable rows without dropping the good ones beside them", () => {
    const views = buildWatchNotices([row({ detail: {} }), clusterRow()])
    expect(views.map((v) => v.key)).toEqual(["red_flag_cluster:illness"])
  })

  it("returns nothing for no events", () => {
    expect(buildWatchNotices([])).toEqual([])
  })
})

describe("voice rules", () => {
  const everyRow = [
    row(),
    row({ anomaly_key: "rating_move:up", direction: "up" }),
    velocityRow(),
    velocityRow({ anomaly_key: "review_velocity:up", direction: "up" }),
    ...["illness", "food_safety", "discrimination", "safety", "legal", "unknown_category"].map((category) =>
      clusterRow({ detail: { windowDays: 30, category, recentCount: 3, baselineExpected: 0 } }),
    ),
    clusterRow({ detail: { windowDays: 30, category: "illness", recentCount: 5, baselineExpected: 2 } }),
  ]

  it("every rendered line passes lintVoice (no em dashes, no kitchen lingo)", () => {
    for (const view of buildWatchNotices(everyRow)) {
      expect(lintVoice(view.title)).toEqual([])
      expect(lintVoice(view.line)).toEqual([])
    }
  })

  it("the panel's own copy passes lintVoice", () => {
    const strings = [
      WATCH_COPY.panel.title,
      WATCH_COPY.panel.sub,
      WATCH_COPY.footer,
      WATCH_COPY.clusterRare,
      WATCH_COPY.clusterAboveUsual,
      ...Object.values(WATCH_COPY.cluster),
    ]
    for (const s of strings) expect(lintVoice(s)).toEqual([])
  })

  it("never names a data source to the operator", () => {
    const all = buildWatchNotices(everyRow)
      .flatMap((v) => [v.title, v.line])
      .concat(WATCH_COPY.panel.sub, WATCH_COPY.footer)
      .join(" ")
      .toLowerCase()
    for (const vendor of ["google", "places", "outscraper", "yelp", "tripadvisor"]) {
      expect(all).not.toContain(vendor)
    }
  })
})
