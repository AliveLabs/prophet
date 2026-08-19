// ALT-676 — first-run duration, anchored on the `starter` job.
//
// The reason this file exists is that the measurement was got WRONG by hand first: anchoring on
// locations.created_at charged us for 12 minutes of an operator reading the screen. So the anchor and
// the work/idle split are pinned here, and the headline case is reproduced from the real prod run.

import { describe, it, expect } from "vitest"
import {
  unionBusyMs,
  percentileMs,
  summarizeColdStarts,
  buildFirstRunSample,
  type FirstRunSample,
} from "@/lib/ops/first-run-duration"

const T0 = Date.parse("2026-08-17T18:32:07Z")
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()
const run = (pipeline: string, startMin: number, endMin: number | null) => ({
  pipeline,
  started_at: at(startMin),
  finished_at: endMin == null ? null : at(endMin),
})

describe("unionBusyMs", () => {
  it("is 0 on an empty list", () => {
    expect(unionBusyMs([])).toBe(0)
  })

  it("sums disjoint intervals", () => {
    expect(unionBusyMs([{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 3000 }])).toBe(2000)
  })

  it("merges overlapping intervals instead of double-counting them", () => {
    // Concurrency 2 in the first-run drain makes overlap the NORMAL case. Summing durations here
    // would report more work than wall clock and therefore negative idle.
    expect(unionBusyMs([{ startMs: 0, endMs: 3000 }, { startMs: 1000, endMs: 2000 }])).toBe(3000)
    expect(unionBusyMs([{ startMs: 0, endMs: 2000 }, { startMs: 1000, endMs: 3000 }])).toBe(3000)
  })

  it("merges a chain of touching intervals into one span", () => {
    expect(
      unionBusyMs([
        { startMs: 0, endMs: 1000 },
        { startMs: 1000, endMs: 2000 },
        { startMs: 1500, endMs: 2500 },
      ]),
    ).toBe(2500)
  })

  it("ignores zero-length and inverted intervals rather than going negative", () => {
    expect(unionBusyMs([{ startMs: 500, endMs: 500 }, { startMs: 900, endMs: 100 }])).toBe(0)
  })

  it("is order-independent", () => {
    const a = [{ startMs: 5000, endMs: 6000 }, { startMs: 0, endMs: 1000 }, { startMs: 900, endMs: 3000 }]
    expect(unionBusyMs(a)).toBe(unionBusyMs([...a].reverse()))
  })
})

describe("percentileMs", () => {
  it("returns null on an empty sample rather than 0 — absent is not fast", () => {
    expect(percentileMs([], 0.5)).toBeNull()
  })

  it("takes nearest rank", () => {
    expect(percentileMs([10, 20, 30], 0.5)).toBe(20)
    expect(percentileMs([10, 20, 30, 40], 0.95)).toBe(40)
    expect(percentileMs([5], 0.95)).toBe(5)
  })
})

describe("buildFirstRunSample", () => {
  it("reproduces the measured prod cold start: 21.2 min total, 4.3 min idle", () => {
    // Jersey Mike's, location 256c8521, 2026-08-17. Verified against prod by interval union on
    // 2026-08-19; the by-hand pass in the earlier session got the same 4.3 min a different way.
    // Shape: pulls finish ~10.2 min in, a gap to insights, then a gap before the brief.
    const sample = buildFirstRunSample({
      locationId: "256c8521",
      locationName: "Jersey Mike's",
      starterStartedAt: at(0),
      runs: [
        run("starter", 0, 0.2),
        // Contiguous through the data pulls on purpose: the only gaps in this fixture are the two
        // REAL ones below, so the assertion is about them and not about invented slack.
        run("content", 0.2, 4.1),
        run("visibility", 0.3, 6.2),
        run("events", 4.2, 8.0),
        run("weather", 6.3, 7.0),
        run("busy_times", 7.1, 9.0),
        run("social", 8.1, 10.2),
        // 2.9 min gap: insights was past the 6.0-min deferral cutoff, so it needed a fresh call.
        run("insights", 13.1, 16.5),
        // 1.4 min gap: the brief cannot start mid-call at all.
        run("brief", 17.9, 21.2),
      ],
      briefTimes: [at(21.2)],
    })
    expect(sample.totalMs).toBeCloseTo(21.2 * 60_000, -2)
    expect((sample.idleMs as number) / 60_000).toBeCloseTo(4.3, 1)
    expect((sample.workMs as number) / 60_000).toBeCloseTo(16.9, 1)
    expect(sample.preWarmed).toBe(false)
  })

  it("flags a pre-warmed run — the 407 BBQ shape, 5 pulls banked before the anchor", () => {
    const sample = buildFirstRunSample({
      locationId: "42cb4703",
      locationName: "407 BBQ",
      starterStartedAt: at(0),
      runs: [
        // Finished while the operator was still in the wizard, so they do not count as our speed.
        run("content", -12, -11),
        run("visibility", -11, -9),
        run("events", -9, -7),
        run("weather", -7, -6),
        run("busy_times", -6, -4),
        run("starter", 0, 0.2),
        run("social", 0.3, 2.0),
        run("insights", 2.1, 6.0),
        run("brief", 6.1, 13.6),
      ],
      briefTimes: [at(13.6)],
    })
    expect(sample.preWarmed).toBe(true)
    expect(sample.preWarmedPulls).toBe(5)
    expect((sample.totalMs as number) / 60_000).toBeCloseTo(13.6, 1)
    // Runs before the anchor are clipped out, so they cannot inflate "work".
    expect(sample.workMs as number).toBeLessThanOrEqual(sample.totalMs as number)
  })

  it("ignores briefs that predate the anchor — yesterday's brief is not this run's output", () => {
    const sample = buildFirstRunSample({
      locationId: "loc",
      locationName: null,
      starterStartedAt: at(0),
      runs: [run("starter", 0, 0.2), run("brief", 1, 9)],
      briefTimes: [at(-1440), at(9)],
    })
    expect(sample.briefAt).toBe(at(9))
    expect((sample.totalMs as number) / 60_000).toBeCloseTo(9, 5)
  })

  it("reports an unfinished run as incomplete rather than guessing a duration", () => {
    const sample = buildFirstRunSample({
      locationId: "loc",
      locationName: null,
      starterStartedAt: at(0),
      runs: [run("starter", 0, 0.2), run("insights", 1, null)],
      briefTimes: [],
    })
    expect(sample.briefAt).toBeNull()
    expect(sample.totalMs).toBeNull()
    expect(sample.idleMs).toBeNull()
  })

  it("treats a run with no finished_at as instantaneous, so a crashed job cannot erase idle time", () => {
    // If an unfinished row were stretched to "now" it would swallow the whole window as work and
    // report zero idle — which is exactly the reassuring wrong answer this metric must not give.
    const sample = buildFirstRunSample({
      locationId: "loc",
      locationName: null,
      starterStartedAt: at(0),
      runs: [run("starter", 0, 0.2), run("insights", 1, null), run("brief", 15, 20)],
      briefTimes: [at(20)],
    })
    expect((sample.idleMs as number) / 60_000).toBeCloseTo(14.8, 1)
  })

  it("never reports negative idle even when runs overlap heavily", () => {
    const sample = buildFirstRunSample({
      locationId: "loc",
      locationName: null,
      starterStartedAt: at(0),
      runs: [run("starter", 0, 10), run("content", 0, 10), run("social", 0, 10), run("brief", 0, 10)],
      briefTimes: [at(10)],
    })
    expect(sample.idleMs).toBe(0)
    expect(sample.workMs).toBe(sample.totalMs)
  })
})

describe("summarizeColdStarts", () => {
  const sample = (totalMin: number, idleMin: number): FirstRunSample => ({
    locationId: `loc-${totalMin}`,
    locationName: null,
    startedAt: at(0),
    briefAt: at(totalMin),
    totalMs: totalMin * 60_000,
    workMs: (totalMin - idleMin) * 60_000,
    idleMs: idleMin * 60_000,
    preWarmedPulls: 0,
    preWarmed: false,
  })

  it("reports nothing rather than zero when there are no samples", () => {
    const s = summarizeColdStarts([])
    expect(s).toEqual({ n: 0, latestMs: null, medianMs: null, p95Ms: null, medianIdleMs: null, idleShare: null })
  })

  it("summarises the two real cold starts on record", () => {
    // 22.3 min / 5.6 idle and 21.2 min / 4.3 idle, newest first, as prod reported 2026-08-19.
    const s = summarizeColdStarts([sample(22.3, 5.6), sample(21.2, 4.3)])
    expect(s.n).toBe(2)
    expect((s.latestMs as number) / 60_000).toBeCloseTo(22.3, 5)
    expect((s.medianMs as number) / 60_000).toBeCloseTo(21.2, 5)
    expect((s.p95Ms as number) / 60_000).toBeCloseTo(22.3, 5)
    // ~20% of the run is idle. This is the number that turns "first runs feel slow" into a fix.
    expect(s.idleShare as number).toBeGreaterThan(0.15)
    expect(s.idleShare as number).toBeLessThan(0.25)
  })

  it("excludes incomplete runs from the stats instead of counting them as fast", () => {
    const incomplete: FirstRunSample = { ...sample(0, 0), briefAt: null, totalMs: null, workMs: null, idleMs: null }
    const s = summarizeColdStarts([incomplete, sample(21.2, 4.3)])
    expect(s.n).toBe(1)
    expect((s.medianMs as number) / 60_000).toBeCloseTo(21.2, 5)
  })

  it("no observed cold start meets the 15-minute claim", () => {
    // Pinned deliberately. If this ever fails because a real run came in under 15 minutes, that is
    // good news and ALT-640 can finally confirm the claim from data.
    const s = summarizeColdStarts([sample(22.3, 5.6), sample(21.2, 4.3)])
    expect(s.medianMs as number).toBeGreaterThan(15 * 60_000)
  })
})
