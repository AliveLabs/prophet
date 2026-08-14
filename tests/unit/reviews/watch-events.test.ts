// Phase 4.2: the watchdog's persistence layer, against a mock store client (no
// database, no clock). Pins the shaping helpers and, more importantly, the two
// halves of the dedupe: the same-day primary-key insert and the cooldown read
// that stops a persisting anomaly from being re-recorded night after night.

import { describe, it, expect } from "vitest"
import {
  newestCaptureMs,
  recordWatchEvents,
  runReviewWatchdog,
  toWatchEventRecords,
  toWatchdogReviews,
  utcDateKey,
  type WatchEventRow,
} from "@/lib/reviews/watch-events"
import { cooldownUntilMs, type ReviewAnomaly } from "@/lib/reviews/watchdog"

const DAY = 86_400_000
const NOW = Date.parse("2026-08-14T09:00:00Z")

const eventRow = (over: Partial<WatchEventRow> = {}): WatchEventRow => ({
  location_id: "loc-1",
  anomaly_key: "rating_move:down",
  kind: "rating_move",
  direction: "down",
  strength: 4.2,
  detail: { windowDays: 30, recentCount: 16, recentMean: 3.3, baselineCount: 180, baselineMean: 4.6, deltaStars: -1.3 },
  fired_on: "2026-08-14",
  cooldown_until: new Date(NOW + 30 * DAY).toISOString(),
  created_at: new Date(NOW).toISOString(),
  ...over,
})

const ratingDrop: ReviewAnomaly = {
  kind: "rating_move",
  key: "rating_move:down",
  direction: "down",
  strength: 4.2,
  cooldownDays: 30,
  detail: { windowDays: 30, recentCount: 16, recentMean: 3.3, baselineCount: 180, baselineMean: 4.6, deltaStars: -1.3 },
}

/** Mock of the loose store surface: the two SELECT chains the watchdog reads
 *  through, plus an INSERT that records every payload and can be made to fail. */
function mockStore(opts: {
  reviewRows?: Array<Record<string, unknown>>
  reviewError?: { code?: string; message: string } | null
  eventRows?: WatchEventRow[]
  eventError?: { code?: string; message: string } | null
  insertError?: (payload: Record<string, unknown>) => { code?: string; message: string } | null
}) {
  const inserts: Array<Record<string, unknown>> = []
  const client = {
    from(table: string) {
      if (table === "location_reviews") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                order: () => ({
                  limit: async () => ({ data: opts.reviewRows ?? [], error: opts.reviewError ?? null }),
                }),
              }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            gt: () => ({
              order: async () => ({ data: opts.eventRows ?? [], error: opts.eventError ?? null }),
            }),
          }),
        }),
        insert: async (payload: Record<string, unknown>) => {
          inserts.push(payload)
          return { error: opts.insertError ? opts.insertError(payload) : null }
        },
      }
    },
  }
  return { client: client as never, inserts }
}

/** A corpus that reliably produces a rating drop and nothing else. */
function droppingCorpus() {
  const rows: Array<Record<string, unknown>> = []
  const stamp = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()
  for (let i = 0; i < 16; i++) {
    rows.push({ rating: [4, 3, 2, 4, 3, 5, 2, 4][i % 8], published_at: stamp(2 + i), red_flags: [], last_seen_at: stamp(0) })
  }
  for (let i = 0; i < 180; i++) {
    rows.push({ rating: i % 5 === 0 ? 4 : 5, published_at: stamp(40 + i), red_flags: [], last_seen_at: stamp(0) })
  }
  return rows
}

// ---------------------------------------------------------------------------

describe("toWatchdogReviews", () => {
  it("drops rows with no parseable publish time rather than dating them to now", () => {
    const shaped = toWatchdogReviews([
      { rating: 5, published_at: "2026-08-01T00:00:00Z", red_flags: [] },
      { rating: 5, published_at: null, red_flags: [] },
      { rating: 5, published_at: "3 weeks ago", red_flags: [] },
    ])
    expect(shaped).toHaveLength(1)
  })

  it("nulls an out-of-range or missing rating but keeps the row as an arrival", () => {
    const shaped = toWatchdogReviews([
      { rating: 9, published_at: "2026-08-01T00:00:00Z" },
      { rating: null, published_at: "2026-08-02T00:00:00Z" },
    ])
    expect(shaped.map((r) => r.rating)).toEqual([null, null])
    expect(shaped).toHaveLength(2)
  })

  it("coerces red_flags to strings and tolerates a non-array", () => {
    const shaped = toWatchdogReviews([
      { rating: 1, published_at: "2026-08-01T00:00:00Z", red_flags: ["illness"] },
      { rating: 1, published_at: "2026-08-02T00:00:00Z", red_flags: "illness" },
    ])
    expect(shaped[0].redFlags).toEqual(["illness"])
    expect(shaped[1].redFlags).toEqual([])
  })
})

describe("newestCaptureMs", () => {
  it("returns the newest parseable last_seen_at", () => {
    expect(
      newestCaptureMs([
        { last_seen_at: "2026-08-01T00:00:00Z" },
        { last_seen_at: "2026-08-12T00:00:00Z" },
        { last_seen_at: "nonsense" },
      ]),
    ).toBe(Date.parse("2026-08-12T00:00:00Z"))
  })

  it("returns null when nothing parses, so the drought suppressor stays on", () => {
    expect(newestCaptureMs([])).toBeNull()
    expect(newestCaptureMs([{ last_seen_at: null }])).toBeNull()
  })
})

describe("toWatchEventRecords / utcDateKey", () => {
  it("maps rows to cooldown records and drops unparseable timestamps", () => {
    const records = toWatchEventRecords([eventRow(), eventRow({ cooldown_until: "not a date" })])
    expect(records).toHaveLength(1)
    expect(records[0].anomalyKey).toBe("rating_move:down")
  })

  it("utcDateKey is the calendar date", () => {
    expect(utcDateKey(NOW)).toBe("2026-08-14")
  })
})

describe("recordWatchEvents", () => {
  it("writes the anomaly, its cooldown, and the numbers behind it", async () => {
    const { client, inserts } = mockStore({})
    const result = await recordWatchEvents(client, "loc-1", [ratingDrop], { nowMs: NOW, firedOn: "2026-08-14" })
    expect(result).toEqual({ recorded: 1, errors: [] })
    expect(inserts[0]).toMatchObject({
      location_id: "loc-1",
      anomaly_key: "rating_move:down",
      kind: "rating_move",
      direction: "down",
      fired_on: "2026-08-14",
    })
    expect(inserts[0].cooldown_until).toBe(new Date(cooldownUntilMs(ratingDrop, NOW)).toISOString())
    expect(inserts[0].detail).toEqual(ratingDrop.detail)
  })

  it("treats a primary-key collision as the dedupe working, not an error", async () => {
    const { client } = mockStore({ insertError: () => ({ code: "23505", message: "duplicate key" }) })
    const result = await recordWatchEvents(client, "loc-1", [ratingDrop], { nowMs: NOW })
    expect(result).toEqual({ recorded: 0, errors: [] })
  })

  it("surfaces any other write failure loudly", async () => {
    const { client } = mockStore({ insertError: () => ({ code: "42P01", message: "relation does not exist" }) })
    const result = await recordWatchEvents(client, "loc-1", [ratingDrop], { nowMs: NOW })
    expect(result.recorded).toBe(0)
    expect(result.errors[0]).toContain("42P01")
  })
})

describe("runReviewWatchdog", () => {
  it("detects and records on a first run", async () => {
    const { client, inserts } = mockStore({ reviewRows: droppingCorpus() })
    const result = await runReviewWatchdog(client, "loc-1", { nowMs: NOW, firedOn: "2026-08-14" })
    expect(result.fired.map((a) => a.key)).toEqual(["rating_move:down"])
    expect(result.errors).toEqual([])
    expect(inserts).toHaveLength(1)
  })

  it("records NOTHING on the next night while the same anomaly persists", async () => {
    const { client, inserts } = mockStore({
      reviewRows: droppingCorpus(),
      // Yesterday's fire, cooldown still running.
      eventRows: [eventRow({ fired_on: "2026-08-13", cooldown_until: new Date(NOW + 29 * DAY).toISOString() })],
    })
    const result = await runReviewWatchdog(client, "loc-1", { nowMs: NOW, firedOn: "2026-08-14" })
    expect(result.detected).toBe(1)
    expect(result.fired).toEqual([])
    expect(inserts).toEqual([])
  })

  it("does nothing on an empty corpus", async () => {
    const { client, inserts } = mockStore({ reviewRows: [] })
    expect(await runReviewWatchdog(client, "loc-1", { nowMs: NOW })).toEqual({ detected: 0, fired: [], errors: [] })
    expect(inserts).toEqual([])
  })

  it("stays silent when the review read fails (fail-soft, never a guess)", async () => {
    const { client, inserts } = mockStore({ reviewError: { code: "42501", message: "permission denied" } })
    expect(await runReviewWatchdog(client, "loc-1", { nowMs: NOW })).toEqual({ detected: 0, fired: [], errors: [] })
    expect(inserts).toEqual([])
  })

  it("still fires when the event table is unreadable, because an unread cooldown must not silence a real finding", async () => {
    // Pre-migration the events table does not exist. The insert then fails loudly
    // and the error surfaces, which is the behavior we want: visible, not silent.
    const { client } = mockStore({
      reviewRows: droppingCorpus(),
      eventError: { code: "42P01", message: "relation does not exist" },
      insertError: () => ({ code: "42P01", message: "relation does not exist" }),
    })
    const result = await runReviewWatchdog(client, "loc-1", { nowMs: NOW })
    expect(result.fired).toHaveLength(1)
    expect(result.errors[0]).toContain("42P01")
  })
})
