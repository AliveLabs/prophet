// ENG-H3: a scheduled brief must build on SETTLED data, not the wall clock. As the fleet grows, the
// worker may not have drained the 06:00 data jobs by the 08:00 brief cron — so a brief defers until
// its location's data jobs finish, bounded by a max wait so a wedged data job can't starve it.

import { describe, it, expect } from "vitest"
import {
  briefShouldWaitForData,
  locationHasPendingDataJobs,
  BRIEF_MAX_DATA_WAIT_MS,
  type SB,
} from "@/lib/jobs/queue"

describe("briefShouldWaitForData", () => {
  it("waits while data is pending and the brief is still within the max window", () => {
    expect(briefShouldWaitForData({ pending: true, briefAgeMs: 60_000 })).toBe(true)
  })
  it("stops waiting once the max window elapses (a stuck data job can't starve the brief)", () => {
    expect(briefShouldWaitForData({ pending: true, briefAgeMs: BRIEF_MAX_DATA_WAIT_MS + 1 })).toBe(false)
  })
  it("never waits when no data is pending", () => {
    expect(briefShouldWaitForData({ pending: false, briefAgeMs: 0 })).toBe(false)
    expect(briefShouldWaitForData({ pending: false, briefAgeMs: BRIEF_MAX_DATA_WAIT_MS + 1 })).toBe(false)
  })
})

// .from().select(id,{count,head}).eq().neq().in() -> { count, error }
const clientWith = (res: { count?: number; error?: unknown }): SB =>
  ({
    from: () => ({
      select: () => ({ eq: () => ({ neq: () => ({ in: () => Promise.resolve(res) }) }) }),
    }),
  }) as unknown as SB

describe("locationHasPendingDataJobs", () => {
  it("is true when data jobs are still queued/running", async () => {
    expect(await locationHasPendingDataJobs(clientWith({ count: 2 }), "loc1")).toBe(true)
  })
  it("is false when nothing is pending", async () => {
    expect(await locationHasPendingDataJobs(clientWith({ count: 0 }), "loc1")).toBe(false)
  })
  it("fails OPEN (false) on a read error so a blip can't stall the brief", async () => {
    expect(await locationHasPendingDataJobs(clientWith({ error: { message: "blip" } }), "loc1")).toBe(false)
  })
})
