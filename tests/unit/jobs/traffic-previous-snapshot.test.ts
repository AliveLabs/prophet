// T1 — unit test for the previous-busy-times-snapshot loader wired into the traffic
// pipeline. busy_times is a delete-and-replace table (no history table exists), so this
// loader MUST run before the fetch step's delete+insert for a given competitor — it
// selects the most recent row(s) at least 5 days older than now, or null when none
// qualify (kept previous:null — unchanged first-capture behavior, emits traffic.baseline).

import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { loadPreviousBusyTimesSnapshot } from "@/lib/jobs/pipelines/traffic"

type Row = {
  day_of_week: number
  hourly_scores: number[]
  peak_hour: number | null
  peak_score: number | null
  slow_hours: number[] | null
  typical_time_spent: string | null
  created_at: string
}

// .from("busy_times").select(...).eq("competitor_id", id).lte("created_at", cutoff).order(...)
// -> { data, error }
function clientReturning(data: Row[] | null, error: unknown = null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          lte: () => ({
            order: () => Promise.resolve({ data, error }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

describe("loadPreviousBusyTimesSnapshot", () => {
  it("selects the most recent qualifying (>=5-day-old) generation, grouped by created_at", async () => {
    // Both rows of the newest generation share the EXACT SAME timestamp (as they would in
    // production: one batch .insert() call, one created_at default per statement) — a
    // fresh daysAgo(7) call per row would drift by a few ms and defeat exact-match grouping.
    const newestGeneration = daysAgo(7)
    const client = clientReturning([
      // newest qualifying generation (7 days old) — both rows share created_at
      {
        day_of_week: 5,
        hourly_scores: Array(24).fill(20),
        peak_hour: 19,
        peak_score: 65,
        slow_hours: [2, 3],
        typical_time_spent: "1-2 hr",
        created_at: newestGeneration,
      },
      {
        day_of_week: 6,
        hourly_scores: Array(24).fill(22),
        peak_hour: 20,
        peak_score: 70,
        slow_hours: [2, 3],
        typical_time_spent: "1-2 hr",
        created_at: newestGeneration,
      },
      // an older generation (14 days old) that must NOT be mixed in
      {
        day_of_week: 5,
        hourly_scores: Array(24).fill(10),
        peak_hour: 18,
        peak_score: 40,
        slow_hours: [1, 2, 3],
        typical_time_spent: "1 hr",
        created_at: daysAgo(14),
      },
    ])

    const result = await loadPreviousBusyTimesSnapshot(client, "comp-1")
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    expect(result!.map((d) => d.day_of_week).sort()).toEqual([5, 6])
    expect(result!.find((d) => d.day_of_week === 5)!.peak_score).toBe(65)
  })

  it("returns null when no row is at least 5 days old (recent-refresh rows never qualify)", async () => {
    // Query filters server-side via .lte("created_at", cutoff); simulate an empty result.
    const client = clientReturning([])
    const result = await loadPreviousBusyTimesSnapshot(client, "comp-1")
    expect(result).toBeNull()
  })

  it("returns null on a read error (fail-soft: keeps first-capture behavior, never throws)", async () => {
    const client = clientReturning(null, { message: "boom" })
    const result = await loadPreviousBusyTimesSnapshot(client, "comp-1")
    expect(result).toBeNull()
  })

  it("returns null when the competitor has no persisted history at all", async () => {
    const client = clientReturning(null)
    const result = await loadPreviousBusyTimesSnapshot(client, "comp-new")
    expect(result).toBeNull()
  })
})
