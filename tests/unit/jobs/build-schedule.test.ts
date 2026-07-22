// Timezone-staggered brief scheduling. Vercel crons are UTC-only, so the build-brief cron runs hourly
// and each location enqueues only at its OWN local build hour (default 3 AM) — staggering the fleet
// across zones instead of one all-at-once burst. Pure functions → fully testable with fixed instants.

import { describe, it, expect } from "vitest"
import {
  isWeeklyFullBuildDay,
  localHourInZone,
  localDateInZone,
  isLocalBuildHour,
  shouldEnqueueBriefNow,
  resolveBuildHour,
  resolveCatchupHours,
  briefJitterSeconds,
  DEFAULT_BUILD_LOCAL_HOUR,
  DEFAULT_CATCHUP_WINDOW_HOURS,
  DEFAULT_JITTER_SPACING_SECONDS,
} from "@/lib/jobs/build-schedule"

describe("localHourInZone", () => {
  it("returns the correct local hour across US zones (summer / EDT)", () => {
    const t = new Date("2026-07-04T07:00:00Z") // 07:00 UTC
    expect(localHourInZone("America/New_York", t)).toBe(3) // EDT UTC-4 → 03:00
    expect(localHourInZone("America/Chicago", t)).toBe(2) // CDT UTC-5 → 02:00
    expect(localHourInZone("America/Denver", t)).toBe(1) // MDT UTC-6 → 01:00
    expect(localHourInZone("America/Los_Angeles", t)).toBe(0) // PDT UTC-7 → 00:00
  })
  it("is DST-aware (winter / EST shifts the UTC mapping by an hour)", () => {
    // NY 3 AM is 07:00 UTC in summer but 08:00 UTC in winter — the hourly cron handles both.
    expect(localHourInZone("America/New_York", new Date("2026-01-15T08:00:00Z"))).toBe(3) // EST UTC-5
    expect(localHourInZone("America/New_York", new Date("2026-01-15T07:00:00Z"))).toBe(2)
  })
  it("returns 0 at local midnight (not 24)", () => {
    expect(localHourInZone("America/New_York", new Date("2026-07-04T04:00:00Z"))).toBe(0) // EDT → 00:00
  })
  it("returns null for an invalid timezone", () => {
    expect(localHourInZone("Not/AZone", new Date("2026-07-04T07:00:00Z"))).toBeNull()
  })
})

describe("isLocalBuildHour — the stagger", () => {
  it("at 07:00 UTC (summer) ONLY the Eastern zone is at the 3 AM build hour", () => {
    const t = new Date("2026-07-04T07:00:00Z")
    expect(isLocalBuildHour("America/New_York", t, 3)).toBe(true)
    expect(isLocalBuildHour("America/Chicago", t, 3)).toBe(false)
    expect(isLocalBuildHour("America/Denver", t, 3)).toBe(false)
    expect(isLocalBuildHour("America/Los_Angeles", t, 3)).toBe(false)
  })
  it("Central hits 3 AM one hour later (08:00 UTC), Eastern has moved on", () => {
    const t = new Date("2026-07-04T08:00:00Z")
    expect(isLocalBuildHour("America/New_York", t, 3)).toBe(false) // now 4 AM ET
    expect(isLocalBuildHour("America/Chicago", t, 3)).toBe(true) // now 3 AM CT
  })
  it("defaults to the 3 AM build hour", () => {
    expect(DEFAULT_BUILD_LOCAL_HOUR).toBe(3)
    expect(isLocalBuildHour("America/New_York", new Date("2026-07-04T07:00:00Z"))).toBe(true)
  })
  it("a missing/invalid timezone falls back to the default zone (never skipped forever)", () => {
    const t = new Date("2026-07-04T07:00:00Z") // 3 AM in the America/New_York fallback
    expect(isLocalBuildHour(null, t, 3)).toBe(true)
    expect(isLocalBuildHour("", t, 3)).toBe(true)
    expect(isLocalBuildHour("Garbage/Zone", t, 3)).toBe(true)
  })
})

describe("briefJitterSeconds — the WITHIN-zone stagger", () => {
  it("spaces a zone's locations spacing-seconds apart (first one immediate)", () => {
    expect(briefJitterSeconds(0, undefined)).toBe(0)
    expect(briefJitterSeconds(1, undefined)).toBe(DEFAULT_JITTER_SPACING_SECONDS)
    expect(briefJitterSeconds(6, undefined)).toBe(6 * DEFAULT_JITTER_SPACING_SECONDS) // 7th location: 42 min
  })
  it("caps at 50 min so every job still starts inside the build hour", () => {
    expect(briefJitterSeconds(50, undefined)).toBe(3000)
  })
  it("honors the env spacing override and falls back on junk", () => {
    expect(briefJitterSeconds(2, "60")).toBe(120)
    expect(briefJitterSeconds(2, "nope")).toBe(2 * DEFAULT_JITTER_SPACING_SECONDS)
    expect(briefJitterSeconds(2, "-5")).toBe(2 * DEFAULT_JITTER_SPACING_SECONDS)
  })
})

describe("resolveBuildHour", () => {
  it("parses a valid env override", () => {
    expect(resolveBuildHour("5")).toBe(5)
    expect(resolveBuildHour("0")).toBe(0)
    expect(resolveBuildHour("23")).toBe(23)
  })
  it("falls back to the default for missing/invalid/out-of-range values", () => {
    expect(resolveBuildHour(undefined)).toBe(DEFAULT_BUILD_LOCAL_HOUR)
    expect(resolveBuildHour("nope")).toBe(DEFAULT_BUILD_LOCAL_HOUR)
    expect(resolveBuildHour("24")).toBe(DEFAULT_BUILD_LOCAL_HOUR)
    expect(resolveBuildHour("-1")).toBe(DEFAULT_BUILD_LOCAL_HOUR)
  })
})

describe("isWeeklyFullBuildDay — the Sunday-local full-refresh gate", () => {
  it("true on Sunday in the location's zone, false other days", () => {
    // 2026-07-05 is a Sunday. 01:00 UTC Sunday = still Saturday evening in LA.
    expect(isWeeklyFullBuildDay("America/New_York", new Date("2026-07-05T12:00:00Z"))).toBe(true)
    expect(isWeeklyFullBuildDay("America/New_York", new Date("2026-07-06T12:00:00Z"))).toBe(false)
    expect(isWeeklyFullBuildDay("America/Los_Angeles", new Date("2026-07-05T01:00:00Z"))).toBe(false)
  })
  it("invalid/missing tz falls back to the default zone", () => {
    expect(isWeeklyFullBuildDay(null, new Date("2026-07-05T12:00:00Z"))).toBe(true)
    expect(isWeeklyFullBuildDay("Junk/Zone", new Date("2026-07-06T12:00:00Z"))).toBe(false)
  })
})

describe("localDateInZone", () => {
  it("returns the local calendar date (YYYY-MM-DD), which can differ from the UTC date", () => {
    // 03:30 EDT on 07-22 is still 07:30 UTC same day.
    expect(localDateInZone("America/New_York", new Date("2026-07-22T07:30:00Z"))).toBe("2026-07-22")
    // 22:00 PT on 07-21 is 05:00 UTC on 07-22 — local date is the 21st, not the 22nd.
    expect(localDateInZone("America/Los_Angeles", new Date("2026-07-22T05:00:00Z"))).toBe("2026-07-21")
  })
  it("returns null for an invalid timezone", () => {
    expect(localDateInZone("Not/AZone", new Date("2026-07-22T07:30:00Z"))).toBeNull()
  })
})

describe("resolveCatchupHours", () => {
  it("defaults, honors env override, clamps out-of-range", () => {
    expect(resolveCatchupHours(undefined)).toBe(DEFAULT_CATCHUP_WINDOW_HOURS)
    expect(resolveCatchupHours("6")).toBe(6)
    expect(resolveCatchupHours("0")).toBe(DEFAULT_CATCHUP_WINDOW_HOURS) // <1 → default
    expect(resolveCatchupHours("99")).toBe(DEFAULT_CATCHUP_WINDOW_HOURS) // >24 → default
    expect(resolveCatchupHours("abc")).toBe(DEFAULT_CATCHUP_WINDOW_HOURS)
  })
})

describe("shouldEnqueueBriefNow (self-heal gate)", () => {
  const tz = "America/New_York" // EDT (UTC-4) in July; build hour 3 AM == 07:00 UTC
  const opts = (lastBriefDateKey: string | null, catchupHours = 4) => ({
    buildHour: 3,
    catchupHours,
    lastBriefDateKey,
  })

  it("enqueues at the build hour when today's brief is missing", () => {
    // 03:00 EDT, local date 07-22, last brief was 07-21 → enqueue.
    expect(shouldEnqueueBriefNow(tz, new Date("2026-07-22T07:00:00Z"), opts("2026-07-21"))).toBe(true)
  })

  it("skips once today's brief exists (later ticks in the window)", () => {
    // 05:00 EDT, but a brief with today's local date_key already exists → skip.
    expect(shouldEnqueueBriefNow(tz, new Date("2026-07-22T09:00:00Z"), opts("2026-07-22"))).toBe(false)
  })

  it("CATCHES UP a missed build-hour tick later the same day (the bug this fixes)", () => {
    // 06:00 EDT (3h after build hour), no brief today → still enqueue.
    expect(shouldEnqueueBriefNow(tz, new Date("2026-07-22T10:00:00Z"), opts("2026-07-21"))).toBe(true)
  })

  it("stops catching up once the window closes (bounded, so persistent failure surfaces)", () => {
    // 07:00 EDT = 4h after build hour = window edge (catchup 4) → skip.
    expect(shouldEnqueueBriefNow(tz, new Date("2026-07-22T11:00:00Z"), opts("2026-07-21"))).toBe(false)
  })

  it("does not enqueue before the build hour", () => {
    // 02:00 EDT (before 3 AM) → skip.
    expect(shouldEnqueueBriefNow(tz, new Date("2026-07-22T06:00:00Z"), opts("2026-07-21"))).toBe(false)
  })

  it("handles a build hour that wraps past midnight", () => {
    // buildHour 23, catchup 4; 00:30 local is 1h after → enqueue.
    const t = new Date("2026-07-22T04:30:00Z") // 00:30 EDT
    expect(shouldEnqueueBriefNow(tz, t, { buildHour: 23, catchupHours: 4, lastBriefDateKey: "2026-07-21" })).toBe(true)
  })

  it("force path is handled by the caller, not here — a missing tz still evaluates via fallback", () => {
    // Invalid tz → FALLBACK_ZONE (America/New_York). At 07:00 UTC that's 03:00, build hour → enqueue.
    expect(shouldEnqueueBriefNow("Bad/Zone", new Date("2026-07-22T07:00:00Z"), opts(null))).toBe(true)
  })
})
