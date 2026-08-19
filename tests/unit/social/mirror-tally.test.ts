// ALT-666 — the image-mirror tally and the collapse rule.
//
// These exist because the LAST counter was wrong in the same direction as the bug it was
// supposed to catch (`mediaUrl.includes("supabase")`, which read 0 for 3.5 weeks while the
// mirror ran at ~97%). So the properties pinned here are the ones that failure violated:
// a tally counts what the mirror actually returned, "not measured" is never "collapsed",
// and routine expired-URL churn never trips the alert.

import { describe, it, expect } from "vitest"
import {
  emptyMirrorTally,
  mergeMirrorTallies,
  isMirrorCollapse,
  describeMirrorFailures,
  type MirrorTally,
} from "@/lib/social/storage"
import { summarizeMirrorRuns, DEFAULT_THRESHOLDS } from "@/lib/ops/pipeline-health"

const tally = (over: Partial<MirrorTally> = {}): MirrorTally => ({
  ...emptyMirrorTally(),
  ...over,
})

describe("mergeMirrorTallies", () => {
  it("is the identity on an empty list", () => {
    expect(mergeMirrorTallies([])).toEqual({ attempted: 0, succeeded: 0, failed: 0, failures: {} })
  })

  it("sums counts and per-reason failures across profiles", () => {
    const merged = mergeMirrorTallies([
      tally({ attempted: 25, succeeded: 24, failed: 1, failures: { http_403: 1 } }),
      tally({ attempted: 25, succeeded: 20, failed: 5, failures: { http_403: 4, timeout: 1 } }),
    ])
    expect(merged.attempted).toBe(50)
    expect(merged.succeeded).toBe(44)
    expect(merged.failed).toBe(5 + 1)
    expect(merged.failures).toEqual({ http_403: 5, timeout: 1 })
  })

  it("does not mutate its inputs", () => {
    const a = tally({ attempted: 1, succeeded: 1 })
    mergeMirrorTallies([a, a])
    expect(a).toEqual({ attempted: 1, succeeded: 1, failed: 0, failures: {} })
  })
})

describe("isMirrorCollapse", () => {
  const min = DEFAULT_THRESHOLDS.mirrorCollapseMinAttempts

  it("is a collapse when a real number of attempts all failed", () => {
    expect(isMirrorCollapse(tally({ attempted: 25, succeeded: 0, failed: 25 }), min)).toBe(true)
  })

  it("is NOT a collapse on a small sample — 0 of 1 is a bad image, not an outage", () => {
    expect(isMirrorCollapse(tally({ attempted: 1, succeeded: 0, failed: 1 }), min)).toBe(false)
  })

  it("is NOT a collapse when anything at all got through", () => {
    expect(isMirrorCollapse(tally({ attempted: 25, succeeded: 1, failed: 24 }), min)).toBe(false)
  })

  it("is NOT a collapse when nothing was attempted", () => {
    expect(isMirrorCollapse(emptyMirrorTally(), min)).toBe(false)
  })
})

describe("describeMirrorFailures", () => {
  it("reports worst reason first so the cause leads", () => {
    expect(
      describeMirrorFailures(tally({ failures: { timeout: 2, http_403: 12, upload_error: 5 } })),
    ).toBe("http_403 × 12, upload_error × 5, timeout × 2")
  })

  it("says none rather than rendering an empty string", () => {
    expect(describeMirrorFailures(emptyMirrorTally())).toBe("none")
  })
})

describe("summarizeMirrorRuns", () => {
  const min = DEFAULT_THRESHOLDS.mirrorCollapseMinAttempts

  it("excludes runs with no tally instead of scoring them zero", () => {
    // The regression this guards: on deploy day every historical social run has no
    // signals.mirror. Counting those as zero-success would fire a collapse alert
    // immediately and teach everyone to ignore the alert.
    const out = summarizeMirrorRuns(
      [{ signals: { completed: 4, failed: 0 } }, { signals: null }, { signals: {} }],
      min,
    )
    expect(out.mirrorRunsSampled).toBe(0)
    expect(out.mirrorCollapsedRuns).toBe(0)
    expect(out.mirrorSuccessRate).toBe(0)
  })

  it("skips runs that attempted nothing — no posts is not evidence either way", () => {
    const out = summarizeMirrorRuns([{ signals: { mirror: emptyMirrorTally() } }], min)
    expect(out.mirrorRunsSampled).toBe(0)
  })

  it("computes the fleet rate and counts only genuinely collapsed runs", () => {
    const out = summarizeMirrorRuns(
      [
        { signals: { mirror: tally({ attempted: 50, succeeded: 49, failed: 1, failures: { http_403: 1 } }) } },
        { signals: { mirror: tally({ attempted: 50, succeeded: 0, failed: 50, failures: { http_404: 50 } }) } },
        // Under the minimum: failed everything, but too small to call an outage.
        { signals: { mirror: tally({ attempted: 2, succeeded: 0, failed: 2, failures: { too_small: 2 } }) } },
      ],
      min,
    )
    expect(out.mirrorRunsSampled).toBe(3)
    expect(out.mirrorCollapsedRuns).toBe(1)
    expect(out.mirrorAttemptsSampled).toBe(102)
    expect(out.mirrorSuccessRate).toBeCloseTo(49 / 102, 5)
    expect(out.mirrorFailures).toEqual({ http_403: 1, http_404: 50, too_small: 2 })
  })

  it("reproduces the 2026-07-24 signature: every run collapsed", () => {
    // What the custom-domain break actually looked like at the mirror. It is only
    // visible at all because the count now comes from the mirror's own return value.
    const runs = Array.from({ length: 9 }, () => ({
      signals: { mirror: tally({ attempted: 100, succeeded: 0, failed: 100, failures: { upload_error: 100 } }) },
    }))
    const out = summarizeMirrorRuns(runs, min)
    expect(out.mirrorCollapsedRuns).toBe(9)
    expect(out.mirrorCollapsedRuns).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.mirrorCollapsedRunsAlert)
  })

  it("ignores malformed tallies rather than throwing on them", () => {
    const out = summarizeMirrorRuns(
      [
        { signals: { mirror: "nope" } },
        { signals: { mirror: { attempted: "12", succeeded: 3 } } },
        { signals: { mirror: { attempted: 10, succeeded: 10, failures: { http_403: "many" } } } },
      ],
      min,
    )
    expect(out.mirrorRunsSampled).toBe(1)
    expect(out.mirrorAttemptsSampled).toBe(10)
    expect(out.mirrorFailures).toEqual({})
  })
})
