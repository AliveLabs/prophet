// Per-location daily-run switch (beta rescue 1.1).
//
// locations.daily_runs_enabled is a non-destructive pause lever, mainly for demo orgs: turn
// off the daily machine (data-pull cron + brief cron) for one location without deleting the
// org, so a paused location stops costing per-call spend (DataForSEO, Anthropic) instead of
// just going stale. Both /api/cron/daily and /api/cron/build-brief read this same pure
// decision function so the gate can't drift between the two crons.

import { describe, it, expect } from "vitest"
import { shouldRunDailyForLocation } from "@/lib/jobs/build-schedule"

describe("shouldRunDailyForLocation — the flag", () => {
  it("runs when the flag is true", () => {
    expect(shouldRunDailyForLocation(true)).toBe(true)
  })

  it("does not run when the flag is false", () => {
    expect(shouldRunDailyForLocation(false)).toBe(false)
  })

  it("defaults to running when the flag is null (pre-migration row / not selected)", () => {
    expect(shouldRunDailyForLocation(null)).toBe(true)
  })

  it("defaults to running when the flag is undefined (stale client type)", () => {
    expect(shouldRunDailyForLocation(undefined)).toBe(true)
  })
})

describe("shouldRunDailyForLocation — explicit single-location override", () => {
  it("an explicit ?location_id= request runs even when the location is paused", () => {
    expect(shouldRunDailyForLocation(false, { explicitLocationId: true })).toBe(true)
  })

  it("an explicit request on an already-enabled location still runs", () => {
    expect(shouldRunDailyForLocation(true, { explicitLocationId: true })).toBe(true)
  })

  it("no explicit flag means no override — a disabled location stays skipped", () => {
    expect(shouldRunDailyForLocation(false, { explicitLocationId: false })).toBe(false)
    expect(shouldRunDailyForLocation(false, {})).toBe(false)
    expect(shouldRunDailyForLocation(false)).toBe(false)
  })
})
