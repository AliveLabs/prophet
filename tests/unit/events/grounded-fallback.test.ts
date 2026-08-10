// Guards for flipping EVENTS_SOURCE to grounded (2026-08-10).
//
// CONTEXT: the DataForSEO Google Events endpoint went fully dark fleet-wide on 2026-08-05,
// answering every query with task status 40102 "No Search Results". The provider treats 40102 as
// a BENIGN empty and returns [] without throwing, so five days of total data loss were written as
// empty snapshots while every run logged `outcome: "fresh"`.
//
// That makes the grounded path's fallback comment ("If THAT also throws it propagates → step fails
// → never a silent empty") false in exactly today's conditions: the fallback does not throw, it
// returns nothing. These tests lock the two fixes.

import { describe, it, expect, vi } from "vitest"
import {
  fetchGroundedEventsWithRetry,
  shouldRefuseEmptyFallback,
  RETRYABLE_GROUNDED_CODES,
} from "@/lib/jobs/pipelines/events"
import { GroundedEventsError } from "@/lib/providers/gemini/google-events"

const INPUT = { locationName: "Arlington,Texas,United States", lat: 32.7553472, lng: -97.097599, maxEvents: 25 }
const EVENT = { title: "BTS World Tour 'ARIRANG'", venue: { name: "AT&T Stadium" } }

describe("fetchGroundedEventsWithRetry — transient generative failures get one retry", () => {
  it("retries a parse_error and returns the second result", async () => {
    // Measured at roughly 1 call in 8 on 2026-08-10; a retry cleared it every time.
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new GroundedEventsError("unparseable", "parse_error"))
      .mockResolvedValueOnce([EVENT])
    const out = await fetchGroundedEventsWithRetry(INPUT, fetcher as never)
    expect(out).toEqual([EVENT])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("retries empty_content (thinking ate the output budget)", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new GroundedEventsError("empty", "empty_content"))
      .mockResolvedValueOnce([EVENT])
    await expect(fetchGroundedEventsWithRetry(INPUT, fetcher as never)).resolves.toEqual([EVENT])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry a quota error — a 429 means the grounding budget is gone", async () => {
    const fetcher = vi.fn().mockRejectedValue(new GroundedEventsError("429", "quota"))
    await expect(fetchGroundedEventsWithRetry(INPUT, fetcher as never)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("does NOT retry an http_error — fetchWithRetry already covers transient 5xx", async () => {
    const fetcher = vi.fn().mockRejectedValue(new GroundedEventsError("500", "http_error"))
    await expect(fetchGroundedEventsWithRetry(INPUT, fetcher as never)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("gives up after the single retry rather than looping", async () => {
    const fetcher = vi.fn().mockRejectedValue(new GroundedEventsError("unparseable", "parse_error"))
    await expect(fetchGroundedEventsWithRetry(INPUT, fetcher as never)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("does not retry when the first call succeeds", async () => {
    const fetcher = vi.fn().mockResolvedValue([EVENT])
    await fetchGroundedEventsWithRetry(INPUT, fetcher as never)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("classifies only the generative failure modes as retryable", () => {
    expect(RETRYABLE_GROUNDED_CODES.has("parse_error")).toBe(true)
    expect(RETRYABLE_GROUNDED_CODES.has("empty_content")).toBe(true)
    expect(RETRYABLE_GROUNDED_CODES.has("quota")).toBe(false)
    expect(RETRYABLE_GROUNDED_CODES.has("http_error")).toBe(false)
  })
})

describe("shouldRefuseEmptyFallback — an empty fallback after a primary failure is an OUTAGE", () => {
  it("refuses to write an empty snapshot when the primary failed", () => {
    // The exact 2026-08-05 shape: grounded throws, DataForSEO returns 40102 -> [] without throwing.
    expect(shouldRefuseEmptyFallback(true, 0)).toBe(true)
  })

  it("accepts a non-empty fallback after a primary failure", () => {
    expect(shouldRefuseEmptyFallback(true, 12)).toBe(false)
  })

  it("allows a genuinely empty result when the primary did NOT fail", () => {
    // A healthy source reporting a quiet week is real data, not an outage.
    expect(shouldRefuseEmptyFallback(false, 0)).toBe(false)
  })

  it("is unaffected by count when the primary succeeded", () => {
    expect(shouldRefuseEmptyFallback(false, 25)).toBe(false)
  })
})
