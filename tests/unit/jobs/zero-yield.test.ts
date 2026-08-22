// ALT-571 Tier 1 — fleet-wide zero-yield detection.
//
// The acceptance criterion is written into the ticket: "On the real data this fires on 2026-08-05,
// the first fully dark day, instead of never." So the fixture below is not invented. It is the
// actual output of `snapshot_yield` against prod for `dataforseo_google_events`, read on 2026-08-22:
//
//   08-01  4/4     08-05  0/4  <- vendor goes dark
//   08-02  3/3     08-06  0/5
//   08-03  1/3     08-07  0/3
//   08-04  3/5     08-08  0/5
//                  08-09  0/5
//                  08-10  5/5  <- recovered
//
// Five consecutive dark days, every one of them logging outcome "fresh" and failed: 0, which is why
// the existing pipeline_runs-based detector sat silent through all of it.

import { describe, expect, it } from "vitest"
import {
  YIELD_PROVIDERS,
  classifyProviderYield,
  describeVerdict,
  shouldPageForStreak,
  yieldConfigPayload,
  type DayYield,
  type YieldProvider,
} from "@/lib/jobs/zero-yield"

const EVENTS: YieldProvider = {
  provider: "dataforseo_google_events",
  label: "Events",
  path: "events",
  kind: "array",
  minSnapshots: 3,
}

/** The real prod numbers for the 2026-08 blackout. */
const BLACKOUT: DayYield[] = [
  { dateKey: "2026-08-01", snapshots: 4, populated: 4 },
  { dateKey: "2026-08-02", snapshots: 3, populated: 3 },
  { dateKey: "2026-08-03", snapshots: 3, populated: 1 },
  { dateKey: "2026-08-04", snapshots: 5, populated: 3 },
  { dateKey: "2026-08-05", snapshots: 4, populated: 0 },
  { dateKey: "2026-08-06", snapshots: 5, populated: 0 },
  { dateKey: "2026-08-07", snapshots: 3, populated: 0 },
  { dateKey: "2026-08-08", snapshots: 5, populated: 0 },
  { dateKey: "2026-08-09", snapshots: 5, populated: 0 },
  { dateKey: "2026-08-10", snapshots: 5, populated: 5 },
]

const at = (day: string) => classifyProviderYield(EVENTS, BLACKOUT, day)

describe("the 2026-08 blackout, which is this ticket's acceptance test", () => {
  it("fires on 2026-08-05, the first dark day", () => {
    const v = at("2026-08-05")
    expect(v.status).toBe("zero")
    expect(v.shouldAlert).toBe(true)
    expect(v.consecutiveZeroDays).toBe(1)
    expect(v.escalation).toBe("first")
    // Actionability is part of the deliverable, not polish.
    expect(v.lastGoodDateKey).toBe("2026-08-04")
  })

  it("escalates on night two rather than repeating at the same volume", () => {
    const v = at("2026-08-06")
    expect(v.consecutiveZeroDays).toBe(2)
    expect(v.shouldAlert).toBe(true)
    expect(v.escalation).toBe("escalated")
  })

  it("stays silent on nights 3 and 5, and pages again on night 4", () => {
    // Backing off is what keeps a long outage out of a muted folder. An alarm people have muted is
    // indistinguishable from no alarm, which is the failure this whole ticket is about.
    expect(at("2026-08-07").shouldAlert).toBe(false) // night 3
    expect(at("2026-08-08").shouldAlert).toBe(true) // night 4, power of two
    expect(at("2026-08-09").shouldAlert).toBe(false) // night 5
  })

  it("still reports status zero on the quiet nights, so a dashboard is never misled", () => {
    // Not alerting is a notification decision. It must not change the verdict.
    for (const d of ["2026-08-07", "2026-08-09"]) {
      expect(at(d).status, d).toBe("zero")
    }
    expect(at("2026-08-09").consecutiveZeroDays).toBe(5)
  })

  it("recognises the recovery on 08-10", () => {
    const v = at("2026-08-10")
    expect(v.status).toBe("healthy")
    expect(v.recovered).toBe(true)
    expect(v.consecutiveZeroDays).toBe(0)
  })

  it("was healthy before it went dark, so this is not an always-on alarm", () => {
    for (const d of ["2026-08-01", "2026-08-02", "2026-08-04"]) {
      const v = at(d)
      expect(v.status, d).toBe("healthy")
      expect(v.shouldAlert, d).toBe(false)
    }
  })

  it("does NOT call 08-03 a collapse, because two prior days is not a baseline", () => {
    // 1/3 is a 33% ratio against a trailing 100%, which looks like a collapse and is not one:
    // there are only two prior measured days. Firing here is how an alerter earns its mute.
    const v = at("2026-08-03")
    expect(v.trailingMedianRatio).toBeNull()
    expect(v.status).toBe("healthy")
    expect(v.shouldAlert).toBe(false)
  })
})

describe("what must stay silent", () => {
  it("a day with too few snapshots is unmeasured, and unmeasured is NOT healthy", () => {
    // The weekly-cadence guard: Starter pulls events on Mondays only, so most days a weekly
    // location legitimately has no row. Treating that as a zero would page ops every Tuesday.
    const days: DayYield[] = [
      { dateKey: "2026-08-01", snapshots: 5, populated: 5 },
      { dateKey: "2026-08-02", snapshots: 1, populated: 0 },
    ]
    const v = classifyProviderYield(EVENTS, days, "2026-08-02")
    expect(v.status).toBe("unmeasured")
    expect(v.shouldAlert).toBe(false)
    // The distinction that matters: it did not claim health it never observed.
    expect(v.status).not.toBe("healthy")
  })

  it("a day with no row at all is unmeasured, not zero", () => {
    const v = classifyProviderYield(EVENTS, BLACKOUT, "2026-08-15")
    expect(v.today).toBeNull()
    expect(v.status).toBe("unmeasured")
    expect(v.shouldAlert).toBe(false)
  })

  it("a provider that has NEVER returned anything does not fire a collapse", () => {
    // No baseline above zero means no collapse to detect. It will still read `zero`, but the
    // never-worked case must not masquerade as a regression.
    const days: DayYield[] = Array.from({ length: 6 }, (_, i) => ({
      dateKey: `2026-08-0${i + 1}`,
      snapshots: 5,
      populated: 0,
    }))
    const v = classifyProviderYield(EVENTS, days, "2026-08-06")
    expect(v.status).toBe("zero")
    expect(v.lastGoodDateKey).toBeNull()
    expect(describeVerdict(v)).toContain("no good day in the window")
  })

  it("one quiet location out of five does not fire", () => {
    const days: DayYield[] = [
      { dateKey: "2026-08-01", snapshots: 5, populated: 5 },
      { dateKey: "2026-08-02", snapshots: 5, populated: 5 },
      { dateKey: "2026-08-03", snapshots: 5, populated: 5 },
      { dateKey: "2026-08-04", snapshots: 5, populated: 4 },
    ]
    const v = classifyProviderYield(EVENTS, days, "2026-08-04")
    expect(v.status).toBe("healthy")
    expect(v.shouldAlert).toBe(false)
  })
})

describe("the collapse detector, for a shortfall that never reaches zero", () => {
  const withBaseline = (todayPopulated: number): DayYield[] => [
    { dateKey: "2026-08-01", snapshots: 10, populated: 10 },
    { dateKey: "2026-08-02", snapshots: 10, populated: 10 },
    { dateKey: "2026-08-03", snapshots: 10, populated: 9 },
    { dateKey: "2026-08-04", snapshots: 10, populated: todayPopulated },
  ]

  it("fires when yield falls below half its own trailing median", () => {
    const v = classifyProviderYield(EVENTS, withBaseline(3), "2026-08-04")
    expect(v.status).toBe("collapsed")
    expect(v.shouldAlert).toBe(true)
    expect(describeVerdict(v)).toContain("30%")
  })

  it("does not fire on an ordinary dip", () => {
    const v = classifyProviderYield(EVENTS, withBaseline(8), "2026-08-04")
    expect(v.status).toBe("healthy")
    expect(v.shouldAlert).toBe(false)
  })

  it("pages once on the transition, not every night it persists", () => {
    const days: DayYield[] = [
      ...withBaseline(3),
      { dateKey: "2026-08-05", snapshots: 10, populated: 3 },
    ]
    const second = classifyProviderYield(EVENTS, days, "2026-08-05")
    expect(second.status).toBe("collapsed")
    expect(second.shouldAlert).toBe(false)
  })

  it("does not double-page when a collapse deepens into a zero", () => {
    // The zero branch owns the escalation from here; a collapse alert on top would be two pages
    // for one cause.
    const days: DayYield[] = [
      ...withBaseline(3),
      { dateKey: "2026-08-05", snapshots: 10, populated: 0 },
    ]
    const v = classifyProviderYield(EVENTS, days, "2026-08-05")
    expect(v.status).toBe("zero")
    expect(v.consecutiveZeroDays).toBe(1)
    expect(v.shouldAlert).toBe(true)
  })
})

describe("the streak-to-page schedule", () => {
  it("pages nights 1 and 2, then only on powers of two", () => {
    const paged = Array.from({ length: 20 }, (_, i) => i + 1).filter(shouldPageForStreak)
    expect(paged).toEqual([1, 2, 4, 8, 16])
  })

  it("never pages on a zero-length streak", () => {
    expect(shouldPageForStreak(0)).toBe(false)
    expect(shouldPageForStreak(-1)).toBe(false)
  })
})

describe("robustness of the inputs", () => {
  it("does not care what order the days arrive in", () => {
    const shuffled = [...BLACKOUT].reverse()
    const a = classifyProviderYield(EVENTS, BLACKOUT, "2026-08-06")
    const b = classifyProviderYield(EVENTS, shuffled, "2026-08-06")
    expect(b).toEqual(a)
  })

  it("ignores days AFTER the one being judged, so a backfill cannot rewrite history", () => {
    const v = classifyProviderYield(EVENTS, BLACKOUT, "2026-08-05")
    // 08-06 onward exist in the fixture and must not count toward the 08-05 streak.
    expect(v.consecutiveZeroDays).toBe(1)
    expect(v.status).toBe("zero")
  })

  it("survives an empty history", () => {
    const v = classifyProviderYield(EVENTS, [], "2026-08-05")
    expect(v.status).toBe("unmeasured")
    expect(v.shouldAlert).toBe(false)
    expect(v.lastGoodDateKey).toBeNull()
  })

  it("skips unmeasured days when walking the streak rather than breaking it", () => {
    // A weekly provider must be able to accrue a second night across a gap, or it can never
    // escalate.
    const days: DayYield[] = [
      { dateKey: "2026-08-01", snapshots: 5, populated: 5 },
      { dateKey: "2026-08-03", snapshots: 5, populated: 0 },
      { dateKey: "2026-08-04", snapshots: 1, populated: 0 }, // too thin to judge
      { dateKey: "2026-08-05", snapshots: 5, populated: 0 },
    ]
    const v = classifyProviderYield(EVENTS, days, "2026-08-05")
    expect(v.consecutiveZeroDays).toBe(2)
    expect(v.escalation).toBe("escalated")
  })
})

describe("the provider config is the single definition of 'populated'", () => {
  it("hands the SQL function exactly the fields it reads, and nothing else", () => {
    // Drift between this payload and the SQL `case cfg.kind` is the one way this detector could
    // silently count the wrong thing, so the payload is derived rather than written twice.
    for (const row of yieldConfigPayload()) {
      expect(Object.keys(row).sort()).toEqual(["kind", "path", "provider"])
      expect(["array", "present"]).toContain(row.kind)
      expect(row.path).not.toBe("")
    }
  })

  it("covers every watched provider with a non-empty label and a real threshold", () => {
    expect(YIELD_PROVIDERS.length).toBeGreaterThan(0)
    for (const p of YIELD_PROVIDERS) {
      expect(p.label.length, p.provider).toBeGreaterThan(0)
      // A threshold of 0 or 1 would make a single-location fleet page on its own quiet day.
      expect(p.minSnapshots, p.provider).toBeGreaterThanOrEqual(2)
    }
  })

  it("watches no provider twice, which would double-page for one cause", () => {
    const names = YIELD_PROVIDERS.map((p) => p.provider)
    expect(new Set(names).size).toBe(names.length)
  })
})
