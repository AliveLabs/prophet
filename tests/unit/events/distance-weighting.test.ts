// Distance is a CONTINUOUS reduction on impact, scaled by draw size — not a cutoff.
// (Bryan, 2026-08-09: "it should not be a cutoff, it should be a reduction on impact,
// but related to attendance/venue size".)
//
// THE OLD MODEL: capture was a 3-step lookup keyed on the geo ROLE, which is itself a step
// function of distance. Two consequences, both wrong:
//   1. A 4x cliff across an arbitrary line — 0.49mi got 0.05 capture, 0.51mi got 0.012.
//   2. Everything past ~3mi scored EXACTLY zero regardless of size, so a sold-out
//      80,000-seat stadium show 4 miles out was modeled as no impact at all.

import { describe, it, expect } from "vitest"
import { captureAt, decayLengthMiles, captivityAt, scoreEventImpact, PEAK_CAPTURE } from "@/lib/events/impact"

describe("captureAt — continuity", () => {
  it("has NO cliff across the old 0.5mi role boundary", () => {
    const a = 850
    const just_inside = captureAt(0.49, a)
    const just_outside = captureAt(0.51, a)
    // Old model dropped 0.05 -> 0.012 across this line: a ratio of 0.24, i.e. losing 76% of
    // an event's modeled impact over two hundredths of a mile. The curve now loses a few
    // percent, which is what "distance reduces impact" should look like.
    expect(just_outside / just_inside).toBeGreaterThan(0.95)
    expect(just_outside / just_inside).toBeLessThan(1)
  })

  it("decreases monotonically with distance", () => {
    const a = 15000
    const samples = [0, 0.5, 1, 2, 3, 5, 8, 12].map((d) => captureAt(d, a))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1])
    }
  })

  it("peaks at the door and never exceeds PEAK_CAPTURE", () => {
    expect(captureAt(0, 850)).toBeCloseTo(PEAK_CAPTURE, 5)
    for (const d of [0, 1, 5, 20]) expect(captureAt(d, 99999)).toBeLessThanOrEqual(PEAK_CAPTURE)
  })

  it("never returns a capture for an unmeasured distance (anti-fabrication)", () => {
    expect(captureAt(null, 80000)).toBe(0)
    expect(captureAt(Number.NaN, 80000)).toBe(0)
  })
})

describe("captureAt — reach scales with the size of the crowd", () => {
  it("a bigger crowd reaches farther at the same distance", () => {
    const stadium = captureAt(4, 68000)
    const club = captureAt(4, 300)
    expect(stadium).toBeGreaterThan(club * 20)
  })

  it("a 16x bigger crowd reaches about 4x farther (sqrt scaling)", () => {
    expect(decayLengthMiles(850 * 16) / decayLengthMiles(850)).toBeCloseTo(4, 1)
  })

  it("people travel farther in rural areas than dense urban ones", () => {
    const a = 5000
    expect(decayLengthMiles(a, "rural")).toBeGreaterThan(decayLengthMiles(a, "suburban"))
    expect(decayLengthMiles(a, "suburban")).toBeGreaterThan(decayLengthMiles(a, "dense_urban"))
  })

  it("clamps both tails so neither a tiny nor an arena-sized event runs away", () => {
    expect(decayLengthMiles(1)).toBeGreaterThanOrEqual(0.3)
    expect(decayLengthMiles(5_000_000)).toBeLessThanOrEqual(8)
  })
})

describe("captureAt — the old calibration anchors still hold", () => {
  // The common case must be unchanged; only the cliffs move.
  it("reproduces the old local_foot capture (~0.05) at a quarter mile", () => {
    expect(captureAt(0.25, 850)).toBeGreaterThan(0.045)
    expect(captureAt(0.25, 850)).toBeLessThan(0.056)
  })

  it("reproduces the old local_traffic capture (~0.012) at 1.5mi", () => {
    expect(captureAt(1.5, 850)).toBeGreaterThan(0.010)
    expect(captureAt(1.5, 850)).toBeLessThan(0.015)
  })
})

describe("captivityAt — the walk-by bonus decays instead of stepping", () => {
  it("is strongest at the door for a big venue and fades with distance", () => {
    expect(captivityAt(0, 85000)).toBeCloseTo(2.0, 2)
    expect(captivityAt(1.5, 85000)).toBeLessThan(captivityAt(0.25, 85000))
    expect(captivityAt(10, 85000)).toBeCloseTo(1.0, 1)
  })

  it("is weaker for a small venue and never below 1", () => {
    expect(captivityAt(0, 800)).toBeLessThan(captivityAt(0, 85000))
    for (const d of [0, 1, 5, 20]) expect(captivityAt(d, 800)).toBeGreaterThanOrEqual(1)
  })
})

describe("the regression this fixes: a stadium show past the old 3mi cutoff", () => {
  const bigShowAt = (distanceMiles: number) =>
    scoreEventImpact({
      capacityLow: 18000,
      capacityHigh: 85000,
      role: distanceMiles <= 3 ? "local_traffic" : "metro_hook",
      distanceMiles,
      isRoute: false,
      ticketSourceCount: 2,
      soldOut: true,
      daypartOverlap: 1,
      serviceModel: "quick service, drive-thru",
      seats: 60,
      densityTier: "suburban",
      eventHour: 20,
    })

  it("scores a REAL effect 4 miles out, where the old model scored exactly zero", () => {
    const far = bigShowAt(4)
    expect(far.absoluteIncremental).toBeGreaterThan(0)
    expect(far.surface).toBe(true)
  })

  it("still scores it LOWER than the same show next door — distance reduces, not deletes", () => {
    expect(bigShowAt(4).absoluteIncremental).toBeLessThan(bigShowAt(0.3).absoluteIncremental)
    expect(bigShowAt(8).absoluteIncremental).toBeLessThan(bigShowAt(4).absoluteIncremental)
  })

  it("falls off smoothly across the old cutoff rather than dropping off a cliff", () => {
    const before = bigShowAt(2.9).absoluteIncremental
    const after = bigShowAt(3.1).absoluteIncremental
    expect(after).toBeGreaterThan(before * 0.9)
  })

  it("still contributes NOTHING when the venue was never geocoded", () => {
    const unplaceable = scoreEventImpact({
      capacityLow: 18000,
      capacityHigh: 85000,
      role: "ungeocoded",
      distanceMiles: null,
      isRoute: false,
      ticketSourceCount: 2,
      daypartOverlap: 1,
      serviceModel: "quick service",
      seats: 60,
      densityTier: "suburban",
      eventHour: 20,
    })
    expect(unplaceable.absoluteIncremental).toBe(0)
  })

  it("route events still add no covers, only disruption", () => {
    const marathon = scoreEventImpact({
      capacityLow: 5000,
      capacityHigh: 5000,
      role: "route_corridor",
      distanceMiles: 0.3,
      isRoute: true,
      ticketSourceCount: 0,
      daypartOverlap: 1,
      serviceModel: "quick service, drive-thru",
      seats: 60,
      densityTier: "suburban",
      eventHour: 9,
    })
    expect(marathon.absoluteIncremental).toBe(0)
  })
})
