// Phase 4.2: the review watchdog's detection band. Pure functions, so these
// tests pin the WHOLE firing decision rather than sampling it.
//
// The three properties the feature lives or dies on, and the reason each block
// below exists:
//   1. LOW-VOLUME NOISE MUST NOT FIRE. A thin corpus produces dramatic-looking
//      swings; a watchdog that reports them gets muted, which is worse than
//      having no watchdog at all.
//   2. A REAL MOVE MUST FIRE. The mirror of (1): a bar set so high that a
//      genuinely bad month passes in silence is equally useless.
//   3. A PERSISTING ANOMALY MUST NOT RE-FIRE. The same finding said nightly is
//      the fastest route to (1)'s failure mode.

import { describe, it, expect } from "vitest"
import {
  REVIEW_WATCHDOG_CONFIG,
  anscombeZ,
  cooldownUntilMs,
  detectRatingMove,
  detectRedFlagClusters,
  detectReviewAnomalies,
  detectVelocityAnomaly,
  mean,
  sampleSd,
  selectFiringAnomalies,
  welchZ,
  type ReviewAnomaly,
  type WatchdogReview,
} from "@/lib/reviews/watchdog"

const DAY = 86_400_000
const NOW = Date.parse("2026-08-14T09:00:00Z")

/** `count` reviews spread evenly across [fromDaysAgo, toDaysAgo). */
function reviews(
  count: number,
  opts: { rating?: number | null; fromDaysAgo: number; toDaysAgo: number; redFlags?: string[] },
): WatchdogReview[] {
  const span = opts.fromDaysAgo - opts.toDaysAgo
  return Array.from({ length: count }, (_, i) => ({
    rating: opts.rating === undefined ? 5 : opts.rating,
    // Evenly spaced, strictly inside the window at both ends.
    publishedAtMs: NOW - (opts.toDaysAgo + (span * (i + 0.5)) / count) * DAY,
    redFlags: opts.redFlags ?? [],
  }))
}

/** Realistic star mixes, so a sample has genuine spread instead of an identical
 *  column (which the standard-deviation floor would otherwise have to rescue).
 *  high = 4.8 average, steady = 4.5, rough = 3.3. */
const STAR_PROFILES = {
  high: [5, 5, 5, 5, 4, 5, 5, 5, 4, 5],
  steady: [5, 5, 4, 5, 4, 5, 4, 5, 4, 4],
  rough: [4, 3, 2, 4, 3, 5, 2, 4, 3, 3],
} as const

function spread(
  count: number,
  profile: keyof typeof STAR_PROFILES,
  fromDaysAgo: number,
  toDaysAgo: number,
): WatchdogReview[] {
  const pattern = STAR_PROFILES[profile]
  const span = fromDaysAgo - toDaysAgo
  return Array.from({ length: count }, (_, i) => ({
    rating: pattern[i % pattern.length],
    publishedAtMs: NOW - (toDaysAgo + (span * (i + 0.5)) / count) * DAY,
    redFlags: [],
  }))
}

// ---------------------------------------------------------------------------

describe("statistics helpers", () => {
  it("mean and sample sd match hand arithmetic", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
    expect(mean([])).toBe(0)
    // sd of [2,4,4,4,5,5,7,9] with n-1 is sqrt(32/7)
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10)
    expect(sampleSd([3])).toBe(0)
  })

  it("welchZ floors the standard deviation, so a zero-variance baseline cannot be infinitely significant", () => {
    const recent = [4, 4, 4, 4, 4, 4, 4, 4]
    const allFives = Array.from({ length: 40 }, () => 5)
    // Both samples have literal sd 0. Without the floor this is a divide by zero.
    const z = welchZ(recent, allFives, REVIEW_WATCHDOG_CONFIG.ratingMinSd)
    expect(Number.isFinite(z)).toBe(true)
    // With sd floored at 0.5 the standard error is sqrt(0.25/8 + 0.25/40) = 0.1936.
    expect(z).toBeCloseTo(-1 / Math.sqrt(0.25 / 8 + 0.25 / 40), 6)
  })

  it("welchZ returns 0 rather than NaN for samples too small to have a spread", () => {
    expect(welchZ([5], [4, 4], 0.5)).toBe(0)
    expect(welchZ([5, 5], [4], 0.5)).toBe(0)
  })

  it("anscombeZ is signed, handles a zero count, and is zero at the expectation", () => {
    expect(anscombeZ(10, 4)).toBeGreaterThan(0)
    expect(anscombeZ(1, 10)).toBeLessThan(0)
    expect(anscombeZ(0, 8)).toBeCloseTo(2 * (Math.sqrt(0.375) - Math.sqrt(8.375)), 10)
    expect(anscombeZ(6, 6)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 1. LOW-VOLUME NOISE MUST NOT FIRE
// ---------------------------------------------------------------------------

describe("rating movement: low-volume noise stays silent", () => {
  it("does not fire for a small restaurant's bad week (too few recent reviews)", () => {
    // The 40-review restaurant: about one review a month, and this month's three
    // were rough. A global threshold would scream. There is not enough here.
    const corpus = [
      ...reviews(3, { rating: 2, fromDaysAgo: 25, toDaysAgo: 1 }),
      ...spread(37, "high", 380, 31),
    ]
    expect(detectRatingMove(corpus, NOW)).toBeNull()
  })

  it("does not fire when the recent window is rich but the location has no history", () => {
    // A brand-new listing: plenty of recent reviews, nothing to compare them to.
    const corpus = [
      ...reviews(20, { rating: 2, fromDaysAgo: 29, toDaysAgo: 1 }),
      ...spread(12, "high", 120, 31),
    ]
    expect(detectRatingMove(corpus, NOW)).toBeNull()
  })

  it("does not fire on a statistically overwhelming but trivially small move", () => {
    // 300 recent at 4.8 against 900 historical at 5.0. The test statistic here is
    // about 6 sigma, so significance alone would fire. A 0.2 star drift is still
    // not worth interrupting an owner over, and the effect floor is what stops it.
    const recent = Array.from({ length: 300 }, (_, i) => ({
      rating: i % 5 === 0 ? 4 : 5,
      publishedAtMs: NOW - (1 + (i % 28)) * DAY,
      redFlags: [] as string[],
    }))
    const baseline = Array.from({ length: 900 }, (_, i) => ({
      rating: 5,
      publishedAtMs: NOW - (31 + (i % 300)) * DAY,
      redFlags: [] as string[],
    }))
    const z = welchZ(
      recent.map((r) => r.rating),
      baseline.map((r) => r.rating),
      REVIEW_WATCHDOG_CONFIG.ratingMinSd,
    )
    expect(Math.abs(z)).toBeGreaterThan(REVIEW_WATCHDOG_CONFIG.ratingZ)
    expect(detectRatingMove([...recent, ...baseline], NOW)).toBeNull()
  })

  it("does not fire on ordinary month-to-month wobble at healthy volume", () => {
    const corpus = [...spread(18, "steady", 29, 1), ...spread(160, "steady", 380, 31)]
    expect(detectRatingMove(corpus, NOW)).toBeNull()
  })
})

describe("review velocity: low-volume noise stays silent", () => {
  it("does not fire for a location whose usual pace is too slow to test", () => {
    // 24 reviews over 180 days is 1.9 expected in a two-week window. Zero reviews
    // this fortnight is an ordinary quiet stretch, not a drought.
    const corpus = [...spread(24, "steady", 194, 15)]
    expect(
      detectVelocityAnomaly(corpus, NOW, { lastCapturedAtMs: NOW - 2 * DAY }),
    ).toBeNull()
  })

  it("does not fire without enough baseline reviews to estimate a rate", () => {
    const corpus = [...spread(15, "steady", 194, 15), ...reviews(9, { fromDaysAgo: 13, toDaysAgo: 1 })]
    expect(detectVelocityAnomaly(corpus, NOW, { lastCapturedAtMs: NOW })).toBeNull()
  })

  it("does not fire on a modest slow patch inside the ordinary band", () => {
    // Expected 7, observed 5. Off the usual pace, but not by enough to say so.
    const corpus = [...spread(90, "steady", 194, 15), ...reviews(5, { fromDaysAgo: 13, toDaysAgo: 1 })]
    expect(detectVelocityAnomaly(corpus, NOW, { lastCapturedAtMs: NOW })).toBeNull()
  })
})

describe("red-flag cluster: low-volume noise stays silent", () => {
  it("does not fire on one or two mentions", () => {
    const corpus = [
      ...reviews(2, { rating: 1, fromDaysAgo: 20, toDaysAgo: 2, redFlags: ["illness"] }),
      ...spread(80, "steady", 380, 31),
    ]
    expect(detectRedFlagClusters(corpus, NOW)).toEqual([])
  })

  it("does not fire when the category is simply this location's normal level", () => {
    // 48 safety mentions across the baseline year is 4 per 30-day window. Three
    // this month is BELOW that. A raw count threshold would have fired.
    const corpus = [
      ...reviews(3, { rating: 2, fromDaysAgo: 25, toDaysAgo: 2, redFlags: ["safety"] }),
      ...reviews(48, { rating: 2, fromDaysAgo: 380, toDaysAgo: 31, redFlags: ["safety"] }),
    ]
    expect(detectRedFlagClusters(corpus, NOW)).toEqual([])
  })

  it("counts a review once per category even when it repeats one", () => {
    const corpus = [
      { rating: 1, publishedAtMs: NOW - 3 * DAY, redFlags: ["illness", "illness", "illness"] },
      { rating: 1, publishedAtMs: NOW - 5 * DAY, redFlags: ["illness", "illness"] },
    ]
    expect(detectRedFlagClusters(corpus, NOW)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. A REAL MOVE MUST FIRE
// ---------------------------------------------------------------------------

describe("rating movement: a real move fires", () => {
  it("fires on a genuinely bad month at healthy volume, and reports both means", () => {
    const corpus = [...spread(16, "rough", 29, 1), ...spread(180, "high", 380, 31)]
    const found = detectRatingMove(corpus, NOW)
    expect(found).not.toBeNull()
    expect(found?.kind).toBe("rating_move")
    expect(found?.direction).toBe("down")
    expect(found?.key).toBe("rating_move:down")
    const detail = found?.detail as { recentMean: number; baselineMean: number; deltaStars: number; recentCount: number }
    expect(detail.recentCount).toBe(16)
    expect(detail.recentMean).toBeLessThan(detail.baselineMean)
    expect(detail.deltaStars).toBeLessThan(-REVIEW_WATCHDOG_CONFIG.ratingMinDeltaStars)
  })

  it("fires on a review-bombing burst even at a small total corpus", () => {
    // The low-volume gates are about EVIDENCE, not size: ten one-star reviews in a
    // month is overwhelming evidence wherever it happens.
    const corpus = [
      ...reviews(10, { rating: 1, fromDaysAgo: 20, toDaysAgo: 1 }),
      ...spread(34, "high", 380, 31),
    ]
    const found = detectRatingMove(corpus, NOW)
    expect(found?.direction).toBe("down")
    expect(found?.strength).toBeGreaterThan(REVIEW_WATCHDOG_CONFIG.ratingZ)
  })

  it("fires upward too, and keys the direction separately", () => {
    const corpus = [...spread(20, "high", 29, 1), ...spread(150, "rough", 380, 31)]
    const found = detectRatingMove(corpus, NOW)
    expect(found?.direction).toBe("up")
    expect(found?.key).toBe("rating_move:up")
  })

  it("carries a cooldown equal to its own observation window", () => {
    const corpus = [...spread(16, "rough", 29, 1), ...spread(180, "high", 380, 31)]
    expect(detectRatingMove(corpus, NOW)?.cooldownDays).toBe(REVIEW_WATCHDOG_CONFIG.ratingRecentDays)
  })
})

describe("review velocity: a real move fires", () => {
  it("fires on a genuine burst", () => {
    // Baseline 90 over 180 days is 7 expected in a fortnight. Eighteen arrived.
    const corpus = [...spread(90, "steady", 194, 15), ...reviews(18, { fromDaysAgo: 13, toDaysAgo: 1 })]
    const found = detectVelocityAnomaly(corpus, NOW, { lastCapturedAtMs: NOW })
    expect(found?.kind).toBe("review_velocity")
    expect(found?.direction).toBe("up")
    expect(found?.key).toBe("review_velocity:up")
    const detail = found?.detail as { recentCount: number; expectedCount: number; ratio: number }
    expect(detail.recentCount).toBe(18)
    expect(detail.expectedCount).toBeCloseTo(7, 5)
    expect(detail.ratio).toBeGreaterThan(REVIEW_WATCHDOG_CONFIG.velocityMinRatio)
  })

  it("fires on a genuine drought", () => {
    const corpus = [...spread(90, "steady", 194, 15), ...reviews(1, { fromDaysAgo: 13, toDaysAgo: 1 })]
    const found = detectVelocityAnomaly(corpus, NOW, { lastCapturedAtMs: NOW - DAY })
    expect(found?.direction).toBe("down")
    expect(found?.key).toBe("review_velocity:down")
  })

  it("a burst still fires when our capture is stale, because we hold the reviews that prove it", () => {
    const corpus = [...spread(90, "steady", 194, 15), ...reviews(18, { fromDaysAgo: 13, toDaysAgo: 1 })]
    const found = detectVelocityAnomaly(corpus, NOW, { lastCapturedAtMs: NOW - 30 * DAY })
    expect(found?.direction).toBe("up")
  })
})

describe("review velocity: the capture-staleness suppressor", () => {
  const droughtCorpus = [...spread(90, "steady", 194, 15), ...reviews(1, { fromDaysAgo: 13, toDaysAgo: 1 })]

  it("suppresses a drought when our newest capture is older than the staleness limit", () => {
    const stale = NOW - (REVIEW_WATCHDOG_CONFIG.captureStaleDays + 1) * DAY
    expect(detectVelocityAnomaly(droughtCorpus, NOW, { lastCapturedAtMs: stale })).toBeNull()
  })

  it("suppresses a drought when capture state is unknown", () => {
    expect(detectVelocityAnomaly(droughtCorpus, NOW, { lastCapturedAtMs: null })).toBeNull()
    expect(detectVelocityAnomaly(droughtCorpus, NOW)).toBeNull()
  })

  it("reports the drought once capture is demonstrably current", () => {
    const fresh = NOW - (REVIEW_WATCHDOG_CONFIG.captureStaleDays - 1) * DAY
    expect(detectVelocityAnomaly(droughtCorpus, NOW, { lastCapturedAtMs: fresh })?.direction).toBe("down")
  })
})

describe("red-flag cluster: a real cluster fires", () => {
  it("fires when a category that never comes up here appears three times", () => {
    const corpus = [
      ...reviews(3, { rating: 1, fromDaysAgo: 25, toDaysAgo: 2, redFlags: ["illness"] }),
      ...spread(120, "steady", 380, 31),
    ]
    const found = detectRedFlagClusters(corpus, NOW)
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe("red_flag_cluster")
    expect(found[0].key).toBe("red_flag_cluster:illness")
    expect(found[0].direction).toBe("up")
    const detail = found[0].detail as { category: string; recentCount: number; baselineExpected: number }
    expect(detail.category).toBe("illness")
    expect(detail.recentCount).toBe(3)
    expect(detail.baselineExpected).toBe(0)
  })

  it("fires on a recurring category only when it stands above this location's own level", () => {
    // Baseline 12 over the year is 1 per 30-day window. Six this month clears it.
    const corpus = [
      ...reviews(6, { rating: 2, fromDaysAgo: 25, toDaysAgo: 2, redFlags: ["food_safety"] }),
      ...reviews(12, { rating: 2, fromDaysAgo: 380, toDaysAgo: 31, redFlags: ["food_safety"] }),
    ]
    const found = detectRedFlagClusters(corpus, NOW)
    expect(found).toHaveLength(1)
    expect(found[0].key).toBe("red_flag_cluster:food_safety")
  })

  it("reports each clustered category separately", () => {
    const corpus = [
      ...reviews(3, { rating: 1, fromDaysAgo: 25, toDaysAgo: 15, redFlags: ["illness"] }),
      ...reviews(3, { rating: 1, fromDaysAgo: 14, toDaysAgo: 2, redFlags: ["discrimination"] }),
      ...spread(120, "steady", 380, 31),
    ]
    const keys = detectRedFlagClusters(corpus, NOW).map((a) => a.key).sort()
    expect(keys).toEqual(["red_flag_cluster:discrimination", "red_flag_cluster:illness"])
  })
})

// ---------------------------------------------------------------------------
// The whole band
// ---------------------------------------------------------------------------

describe("detectReviewAnomalies", () => {
  it("returns nothing for a quiet, healthy location", () => {
    const corpus = [...spread(18, "steady", 29, 1), ...spread(200, "steady", 380, 31)]
    expect(detectReviewAnomalies({ reviews: corpus, nowMs: NOW, lastCapturedAtMs: NOW })).toEqual([])
  })

  it("returns nothing for an empty corpus", () => {
    expect(detectReviewAnomalies({ reviews: [], nowMs: NOW, lastCapturedAtMs: NOW })).toEqual([])
  })

  it("ranks a red-flag cluster ahead of a rating move", () => {
    const corpus = [
      ...reviews(4, { rating: 1, fromDaysAgo: 25, toDaysAgo: 2, redFlags: ["illness"] }),
      ...spread(14, "rough", 28, 1),
      ...spread(180, "high", 380, 31),
    ]
    const found = detectReviewAnomalies({ reviews: corpus, nowMs: NOW, lastCapturedAtMs: NOW })
    expect(found.length).toBeGreaterThan(1)
    expect(found[0].kind).toBe("red_flag_cluster")
  })

  it("ignores reviews with no usable star rating for the rating test but still counts them as arrivals", () => {
    // 18 star-less arrivals in a fortnight against an expected 7: velocity fires,
    // rating cannot and does not.
    const corpus = [
      ...spread(90, "steady", 194, 15),
      ...reviews(18, { rating: null, fromDaysAgo: 13, toDaysAgo: 1 }),
    ]
    const kinds = detectReviewAnomalies({ reviews: corpus, nowMs: NOW, lastCapturedAtMs: NOW }).map((a) => a.kind)
    expect(kinds).toContain("review_velocity")
    expect(kinds).not.toContain("rating_move")
  })
})

// ---------------------------------------------------------------------------
// 3. A PERSISTING ANOMALY MUST NOT RE-FIRE
// ---------------------------------------------------------------------------

describe("cooldown", () => {
  const ratingDrop: ReviewAnomaly = {
    kind: "rating_move",
    key: "rating_move:down",
    direction: "down",
    strength: 4.2,
    cooldownDays: 30,
    detail: { windowDays: 30, recentCount: 16, recentMean: 3.3, baselineCount: 180, baselineMean: 4.6, deltaStars: -1.3 },
  }
  const drought: ReviewAnomaly = {
    kind: "review_velocity",
    key: "review_velocity:down",
    direction: "down",
    strength: 3.1,
    cooldownDays: 14,
    detail: { windowDays: 14, baselineDays: 180, recentCount: 1, expectedCount: 7, ratio: 0.14 },
  }

  it("cooldownUntilMs is the anomaly's own window past now", () => {
    expect(cooldownUntilMs(ratingDrop, NOW)).toBe(NOW + 30 * DAY)
    expect(cooldownUntilMs(drought, NOW)).toBe(NOW + 14 * DAY)
  })

  it("fires the first time, with no prior events", () => {
    expect(selectFiringAnomalies([ratingDrop], [], NOW)).toEqual([ratingDrop])
  })

  it("does NOT re-fire the next night while the same anomaly persists", () => {
    const firedAt = NOW - DAY
    const prior = [{ anomalyKey: ratingDrop.key, cooldownUntilMs: cooldownUntilMs(ratingDrop, firedAt) }]
    expect(selectFiringAnomalies([ratingDrop], prior, NOW)).toEqual([])
  })

  it("stays silent every night for the whole cooldown, then speaks again", () => {
    const firedAt = NOW
    const prior = [{ anomalyKey: ratingDrop.key, cooldownUntilMs: cooldownUntilMs(ratingDrop, firedAt) }]
    for (let day = 1; day < 30; day++) {
      expect(selectFiringAnomalies([ratingDrop], prior, firedAt + day * DAY)).toEqual([])
    }
    expect(selectFiringAnomalies([ratingDrop], prior, firedAt + 30 * DAY)).toEqual([ratingDrop])
  })

  it("suppresses only the matching key, so a different anomaly still gets through", () => {
    const prior = [{ anomalyKey: ratingDrop.key, cooldownUntilMs: NOW + 20 * DAY }]
    expect(selectFiringAnomalies([ratingDrop, drought], prior, NOW)).toEqual([drought])
  })

  it("does not let a rating DROP silence a later rating RECOVERY", () => {
    const recovery: ReviewAnomaly = { ...ratingDrop, key: "rating_move:up", direction: "up" }
    const prior = [{ anomalyKey: "rating_move:down", cooldownUntilMs: NOW + 20 * DAY }]
    expect(selectFiringAnomalies([recovery], prior, NOW)).toEqual([recovery])
  })

  it("honors the LATEST cooldown when several rows share a key", () => {
    const prior = [
      { anomalyKey: ratingDrop.key, cooldownUntilMs: NOW - 5 * DAY },
      { anomalyKey: ratingDrop.key, cooldownUntilMs: NOW + 5 * DAY },
    ]
    expect(selectFiringAnomalies([ratingDrop], prior, NOW)).toEqual([])
  })

  it("treats the cooldown boundary as expired, so a run exactly on it is not lost", () => {
    const prior = [{ anomalyKey: ratingDrop.key, cooldownUntilMs: NOW }]
    expect(selectFiringAnomalies([ratingDrop], prior, NOW)).toEqual([ratingDrop])
  })
})
