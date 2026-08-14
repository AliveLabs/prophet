import { describe, it, expect } from "vitest"
import {
  buildMarketBenchmark,
  formatBenchmarkLine,
  resolveStoredRating,
  MIN_COMPARED_COMPETITORS,
  MIN_REVIEWS_FOR_COMPARISON,
  RATING_PARITY_BAND,
  type RatedEntity,
} from "@/lib/insights/market-benchmark"

/** A competitor that clears the review floor, so tests isolate one variable at a time. */
function rival(rating: number, reviewCount = 400): RatedEntity {
  return { rating, reviewCount }
}

const SET = [rival(4.3), rival(4.1), rival(4.5), rival(4.2), rival(4.0)]

describe("buildMarketBenchmark — the minimum-data floor", () => {
  it("renders NOTHING when the operator's own rating is missing", () => {
    expect(buildMarketBenchmark({ rating: null, reviewCount: 900 }, SET)).toBeNull()
  })

  it("renders NOTHING when the operator's own review count is missing", () => {
    expect(buildMarketBenchmark({ rating: 4.6, reviewCount: null }, SET)).toBeNull()
  })

  it("renders NOTHING below the operator's review floor, and renders AT it", () => {
    const below = buildMarketBenchmark({ rating: 4.6, reviewCount: MIN_REVIEWS_FOR_COMPARISON - 1 }, SET)
    const at = buildMarketBenchmark({ rating: 4.6, reviewCount: MIN_REVIEWS_FOR_COMPARISON }, SET)
    expect(below).toBeNull()
    expect(at).not.toBeNull()
  })

  it("renders NOTHING with fewer than three comparable competitors", () => {
    const own = { rating: 4.6, reviewCount: 812 }
    expect(buildMarketBenchmark(own, [])).toBeNull()
    expect(buildMarketBenchmark(own, [rival(4.3)])).toBeNull()
    expect(buildMarketBenchmark(own, [rival(4.3), rival(4.1)])).toBeNull()
    expect(buildMarketBenchmark(own, [rival(4.3), rival(4.1), rival(4.5)])).not.toBeNull()
    expect(MIN_COMPARED_COMPETITORS).toBe(3)
  })

  it("applies the SAME review floor to competitors, so a thin rating cannot drag the median", () => {
    const own = { rating: 4.6, reviewCount: 812 }
    const thin = [rival(5.0, 4), rival(5.0, 9), rival(5.0, 11)]
    // Three competitors, but none of them comparable: below the floor.
    expect(buildMarketBenchmark(own, thin)).toBeNull()

    const mixed = [rival(5.0, 4), rival(4.3), rival(4.1), rival(4.5)]
    const b = buildMarketBenchmark(own, mixed)
    expect(b?.comparedCount).toBe(3) // the four-review 5.0 is excluded
    expect(b?.medianRating).toBe(4.3)
  })

  it("counts only competitors that CLEARED the floor, not the tracked total", () => {
    const b = buildMarketBenchmark({ rating: 4.6, reviewCount: 812 }, [...SET, rival(2.0, 3), { rating: null, reviewCount: 900 }])
    expect(b?.comparedCount).toBe(SET.length)
  })

  it("rejects ratings outside a five-point scale rather than comparing garbage", () => {
    expect(buildMarketBenchmark({ rating: 0, reviewCount: 900 }, SET)).toBeNull()
    expect(buildMarketBenchmark({ rating: 7.2, reviewCount: 900 }, SET)).toBeNull()
    const b = buildMarketBenchmark({ rating: 4.6, reviewCount: 812 }, [...SET, { rating: 9, reviewCount: 900 }])
    expect(b?.comparedCount).toBe(SET.length)
  })

  it("rejects non-finite figures", () => {
    expect(buildMarketBenchmark({ rating: Number.NaN, reviewCount: 900 }, SET)).toBeNull()
    expect(buildMarketBenchmark({ rating: 4.6, reviewCount: Number.POSITIVE_INFINITY }, SET)).toBeNull()
  })
})

describe("buildMarketBenchmark — the arithmetic", () => {
  it("takes the median, not the mean, so one outlier cannot set the middle", () => {
    const b = buildMarketBenchmark({ rating: 4.6, reviewCount: 812 }, [rival(4.3), rival(4.2), rival(1.0)])
    expect(b?.medianRating).toBe(4.2)
  })

  it("averages the two middles on an even set", () => {
    const b = buildMarketBenchmark({ rating: 4.6, reviewCount: 812 }, [rival(4.0), rival(4.2), rival(4.4), rival(4.6)])
    expect(b?.medianRating).toBe(4.3)
  })

  it("reads above / level / below off the numbers it displays", () => {
    const own = { rating: 4.6, reviewCount: 812 }
    expect(buildMarketBenchmark(own, [rival(4.3), rival(4.3), rival(4.3)])?.standing).toBe("above")
    expect(buildMarketBenchmark(own, [rival(4.6), rival(4.6), rival(4.6)])?.standing).toBe("level")
    expect(buildMarketBenchmark(own, [rival(4.9), rival(4.9), rival(4.9)])?.standing).toBe("below")
  })

  it("calls a sub-tenth gap LEVEL — the smallest movement this product will call a change", () => {
    const b = buildMarketBenchmark({ rating: 4.64, reviewCount: 812 }, [rival(4.58), rival(4.58), rival(4.58)])
    expect(b?.ownRating).toBe(4.6)
    expect(b?.medianRating).toBe(4.6)
    expect(b?.standing).toBe("level")
    expect(RATING_PARITY_BAND).toBe(0.1)
  })

  it("never contradicts itself: the rendered numbers always support the standing word", () => {
    const b = buildMarketBenchmark({ rating: 4.449, reviewCount: 812 }, [rival(4.351), rival(4.351), rival(4.351)])
    expect(b?.ownRating).toBe(4.4)
    expect(b?.medianRating).toBe(4.4)
    expect(b?.standing).toBe("level")
  })
})

describe("formatBenchmarkLine", () => {
  const b = buildMarketBenchmark({ rating: 4.6, reviewCount: 812 }, SET)!

  it("denominates both sides", () => {
    expect(formatBenchmarkLine(b)).toBe(
      "Above the set: your 4.6 across 812 reviews vs a 4.2 median across 5 tracked competitors.",
    )
  })

  it("never names a competitor and never claims a cause", () => {
    const line = formatBenchmarkLine(b)
    expect(line).not.toMatch(/because|caused|driving|thanks to/i)
    expect(line).not.toMatch(/best|worst|leader|beating|crushing|dominat/i)
    expect(line).not.toContain("—")
  })

  it("thousands-separates a large review count", () => {
    const big = buildMarketBenchmark({ rating: 4.6, reviewCount: 12480 }, SET)!
    expect(formatBenchmarkLine(big)).toContain("12,480 reviews")
  })

  it("words the level and below cases without a superlative", () => {
    const level = buildMarketBenchmark({ rating: 4.2, reviewCount: 300 }, SET)!
    const below = buildMarketBenchmark({ rating: 3.8, reviewCount: 300 }, SET)!
    expect(formatBenchmarkLine(level)).toContain("Level with the set:")
    expect(formatBenchmarkLine(below)).toContain("Below the set:")
  })

  it("keeps the competitor noun singular when only one cleared the floor", () => {
    expect(
      formatBenchmarkLine({
        ownRating: 4.6,
        ownReviewCount: 100,
        medianRating: 4.3,
        comparedCount: 1,
        standing: "above",
      }),
    ).toContain("1 tracked competitor.")
  })
})

describe("resolveStoredRating", () => {
  it("prefers the freshest listing snapshot", () => {
    expect(
      resolveStoredRating({
        snapshotProfile: { rating: 4.5, reviewCount: 300 },
        placeDetails: { rating: 4.1, reviewCount: 100 },
        metadata: { rating: 3.9, reviewCount: 50 },
      }),
    ).toEqual({ rating: 4.5, reviewCount: 300 })
  })

  it("falls through to placeDetails, then to top-level metadata", () => {
    expect(resolveStoredRating({ snapshotProfile: null, placeDetails: { rating: 4.1, reviewCount: 100 } })).toEqual({
      rating: 4.1,
      reviewCount: 100,
    })
    // The discover-then-approve flow stores the rating at metadata.rating.
    expect(resolveStoredRating({ metadata: { rating: 3.9, reviewCount: 50 } })).toEqual({
      rating: 3.9,
      reviewCount: 50,
    })
  })

  it("fills each field independently, so a snapshot missing the count still uses its rating", () => {
    expect(
      resolveStoredRating({ snapshotProfile: { rating: 4.5 }, metadata: { reviewCount: 220 } }),
    ).toEqual({ rating: 4.5, reviewCount: 220 })
  })

  it("reads Google's userRatingCount spelling as well", () => {
    expect(resolveStoredRating({ placeDetails: { rating: 4.4, userRatingCount: 615 } })).toEqual({
      rating: 4.4,
      reviewCount: 615,
    })
  })

  it("returns nulls rather than guesses when nothing is stored", () => {
    expect(resolveStoredRating({})).toEqual({ rating: null, reviewCount: null })
    expect(resolveStoredRating({ snapshotProfile: "nope", metadata: 7 })).toEqual({ rating: null, reviewCount: null })
    expect(resolveStoredRating({ metadata: { rating: "4.5", reviewCount: "80" } })).toEqual({
      rating: null,
      reviewCount: null,
    })
  })

  it("a null-everything competitor is simply not comparable", () => {
    const unknown = resolveStoredRating({})
    expect(buildMarketBenchmark({ rating: 4.6, reviewCount: 812 }, [unknown, unknown, unknown])).toBeNull()
  })
})
