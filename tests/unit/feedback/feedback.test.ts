// ALT-371 — beta feedback input normalization. The server action trusts these to gate what
// gets stored: unknown category → null, empty message → null (rejected), bounded lengths.

import { describe, it, expect } from "vitest"
import {
  normalizeCategory,
  normalizeMessage,
  normalizePagePath,
  FEEDBACK_MAX_MESSAGE,
} from "@/lib/feedback/feedback"

describe("normalizeCategory", () => {
  it("keeps known categories", () => {
    expect(normalizeCategory("idea")).toBe("idea")
    expect(normalizeCategory("issue")).toBe("issue")
    expect(normalizeCategory("confusing")).toBe("confusing")
    expect(normalizeCategory("praise")).toBe("praise")
  })
  it("drops unknown / empty to null", () => {
    expect(normalizeCategory("bug")).toBeNull()
    expect(normalizeCategory("")).toBeNull()
    expect(normalizeCategory(null)).toBeNull()
    expect(normalizeCategory(undefined)).toBeNull()
  })
})

describe("normalizeMessage", () => {
  it("trims and returns the message", () => {
    expect(normalizeMessage("  hello  ")).toBe("hello")
  })
  it("returns null for empty / whitespace-only", () => {
    expect(normalizeMessage("")).toBeNull()
    expect(normalizeMessage("   ")).toBeNull()
    expect(normalizeMessage(null)).toBeNull()
  })
  it("bounds to the max length", () => {
    const long = "x".repeat(FEEDBACK_MAX_MESSAGE + 500)
    expect(normalizeMessage(long)?.length).toBe(FEEDBACK_MAX_MESSAGE)
  })
})

describe("normalizePagePath", () => {
  it("keeps a route, bounds length, nulls empty", () => {
    expect(normalizePagePath("/home")).toBe("/home")
    expect(normalizePagePath("")).toBeNull()
    expect(normalizePagePath("/" + "a".repeat(400))?.length).toBe(300)
  })
})
