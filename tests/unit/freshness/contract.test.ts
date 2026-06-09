import { describe, it, expect } from "vitest"
import {
  classifyAtCapture,
  classifyNow,
  bucket,
  daysBetween,
  isUsable,
} from "@/lib/freshness/contract"
import {
  socialContentAsOf,
  reviewsContentAsOf,
  captureAsContent,
  extractContentAsOf,
} from "@/lib/freshness/extract"

describe("daysBetween", () => {
  it("computes whole-day gaps and returns null on unparseable input", () => {
    expect(daysBetween("2026-06-09T00:00:00Z", "2026-06-02T00:00:00Z")).toBe(7)
    expect(daysBetween("2026-06-09T00:00:00Z", "not-a-date")).toBeNull()
    expect(daysBetween(null, "2026-06-02T00:00:00Z")).toBeNull()
  })
})

describe("bucket", () => {
  it("buckets by signal kind thresholds", () => {
    expect(bucket(10, "social")).toBe("fresh")
    expect(bucket(60, "social")).toBe("aging")
    expect(bucket(120, "social")).toBe("dormant")
    expect(bucket(-2, "social")).toBe("fresh") // content newer than capture clamps to fresh
    expect(bucket(null, "social")).toBe("undated")
  })
})

describe("classifyAtCapture — the core defect guard", () => {
  it("flags a 4-year-old post captured today as DORMANT, never fresh", () => {
    // The real Bush's Chicken case from the prod audit.
    expect(
      classifyAtCapture({
        contentAsOf: "2022-01-07T16:01:00Z",
        capturedAt: "2026-06-09T14:35:00Z",
        kind: "social",
      })
    ).toBe("dormant")
  })

  it("keeps genuinely recent content fresh", () => {
    expect(
      classifyAtCapture({
        contentAsOf: "2026-06-02T10:00:00Z",
        capturedAt: "2026-06-09T10:00:00Z",
        kind: "social",
      })
    ).toBe("fresh")
  })

  it("reports empty profiles as empty and undated content as undated", () => {
    expect(classifyAtCapture({ contentAsOf: null, capturedAt: "2026-06-09T00:00:00Z", isEmpty: true, kind: "social" })).toBe("empty")
    expect(classifyAtCapture({ contentAsOf: null, capturedAt: "2026-06-09T00:00:00Z", kind: "social" })).toBe("undated")
  })
})

describe("classifyNow — read-time usability", () => {
  it("treats a long-uncaptured listing snapshot as stale even if it was fresh when captured", () => {
    // listing data is as-of-capture; 40 days later it is past the listing aging window.
    expect(
      classifyNow({
        contentAsOf: "2026-04-30T00:00:00Z",
        capturedAt: "2026-04-30T00:00:00Z",
        kind: "listing",
        now: "2026-06-09T00:00:00Z",
      })
    ).toBe("dormant")
  })

  it("a dormant social account is unusable now", () => {
    const status = classifyNow({
      contentAsOf: "2022-01-07T00:00:00Z",
      capturedAt: "2026-06-09T00:00:00Z",
      kind: "social",
      now: "2026-06-09T00:00:00Z",
    })
    expect(status).toBe("dormant")
    expect(isUsable(status)).toBe(false)
  })
})

describe("socialContentAsOf", () => {
  it("finds the newest date across normalized recentPosts", () => {
    const raw = {
      recentPosts: [
        { createdTime: "2023-08-31T15:00:12Z" },
        { createdTime: "2023-05-01T15:50:06Z" },
      ],
    }
    expect(socialContentAsOf(raw).contentAsOf).toBe("2023-08-31T15:00:12.000Z")
  })

  it("handles the legacy raw shape (created_time / unix timestamp)", () => {
    expect(socialContentAsOf({ recentPosts: [{ created_time: "2024-02-01T00:00:00Z" }] }).contentAsOf).toBe(
      "2024-02-01T00:00:00.000Z"
    )
    const unix = Math.floor(Date.parse("2024-03-01T00:00:00Z") / 1000)
    expect(socialContentAsOf({ recentPosts: [{ timestamp: unix }] }).contentAsOf).toBe("2024-03-01T00:00:00.000Z")
  })

  it("marks zero-post profiles empty and dated-less posts undated", () => {
    expect(socialContentAsOf({ recentPosts: [] })).toEqual({ contentAsOf: null, isEmpty: true })
    expect(socialContentAsOf({ recentPosts: [{ likesCount: 3 }] })).toEqual({ contentAsOf: null, isEmpty: false })
    expect(socialContentAsOf(null)).toEqual({ contentAsOf: null, isEmpty: true })
  })
})

describe("reviewsContentAsOf + captureAsContent + dispatch", () => {
  it("drops relative review strings (honest undated) and keeps absolute dates", () => {
    expect(reviewsContentAsOf([{ date: "2 weeks ago" }]).contentAsOf).toBeNull()
    expect(reviewsContentAsOf([{ date: "2026-05-01T00:00:00Z" }]).contentAsOf).toBe("2026-05-01T00:00:00.000Z")
  })

  it("captureAsContent and dispatch fall back to capture time for as-of-capture signals", () => {
    expect(captureAsContent("2026-06-09T00:00:00Z")).toEqual({ contentAsOf: "2026-06-09T00:00:00Z", isEmpty: false })
    expect(extractContentAsOf("menu", { items: [] }, "2026-06-09T00:00:00Z").contentAsOf).toBe("2026-06-09T00:00:00Z")
    expect(extractContentAsOf("social", { recentPosts: [{ createdTime: "2025-01-01T00:00:00Z" }] }, "2026-06-09T00:00:00Z").contentAsOf).toBe(
      "2025-01-01T00:00:00.000Z"
    )
  })
})
