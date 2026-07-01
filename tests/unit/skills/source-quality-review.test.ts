import { describe, test, expect } from "vitest"
import {
  targetReviewStatusFor,
  isAllowedReviewTransition,
  parseFlagRef,
  type ReviewStatus,
  type ReviewAction,
} from "@/lib/skills/source-quality-review"

describe("targetReviewStatusFor", () => {
  test("resolve -> resolved", () => {
    expect(targetReviewStatusFor("resolve")).toBe("resolved")
  })
  test("reopen -> open", () => {
    expect(targetReviewStatusFor("reopen")).toBe("open")
  })
})

describe("isAllowedReviewTransition", () => {
  test("resolve is allowed from open", () => {
    expect(isAllowedReviewTransition("open", "resolve")).toBe(true)
  })
  test("resolve is rejected as a no-op from resolved", () => {
    expect(isAllowedReviewTransition("resolved", "resolve")).toBe(false)
  })
  test("reopen is allowed from resolved", () => {
    expect(isAllowedReviewTransition("resolved", "reopen")).toBe(true)
  })
  test("reopen is rejected as a no-op from open", () => {
    expect(isAllowedReviewTransition("open", "reopen")).toBe(false)
  })
})

describe("parseFlagRef", () => {
  test("parses a brief play flag id into its natural key", () => {
    const ref = parseFlagRef("brief:loc1:2026-06-28:reviews-expert::Fix slow Friday service")
    expect(ref).toEqual({
      kind: "brief_play",
      locationId: "loc1",
      dateKey: "2026-06-28",
      playKey: "reviews-expert::Fix slow Friday service",
    })
  })

  test("parses an insight flag id", () => {
    const ref = parseFlagRef("insight:abc-123")
    expect(ref).toEqual({ kind: "insight", id: "abc-123" })
  })

  test("rejects a malformed ref", () => {
    expect(parseFlagRef("bogus:xyz")).toBeNull()
    expect(parseFlagRef("")).toBeNull()
    expect(parseFlagRef("brief:onlytwo")).toBeNull()
    expect(parseFlagRef("insight:")).toBeNull()
  })
})

describe("type-level exhaustiveness", () => {
  test("ReviewStatus/ReviewAction stay in lockstep with targetReviewStatusFor", () => {
    const actions: ReviewAction[] = ["resolve", "reopen"]
    const statuses = actions.map(targetReviewStatusFor)
    const expected: ReviewStatus[] = ["resolved", "open"]
    expect(statuses).toEqual(expected)
  })
})
