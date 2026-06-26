// DataForSEO 40501 "Invalid Field" guard (2026-06-25): event probe keywords are cataloged venue names
// used verbatim; a venue with a "/" ("McKinney North Football/Soccer Auxiliary Field") tripped a
// task-level 40501 → silent partial run. sanitizeEventKeyword normalizes the structural separators.

import { describe, it, expect } from "vitest"
import { sanitizeEventKeyword } from "@/lib/providers/dataforseo/google-events"

describe("sanitizeEventKeyword", () => {
  it("replaces a slash (the observed 40501 trigger) with a space", () => {
    expect(sanitizeEventKeyword("McKinney North Football/Soccer Auxiliary Field")).toBe(
      "McKinney North Football Soccer Auxiliary Field",
    )
  })
  it("strips other structural separators and collapses whitespace", () => {
    expect(sanitizeEventKeyword("A | B \\ C <d>")).toBe("A B C d")
  })
  it("preserves ordinary venue punctuation (& - ' . ,)", () => {
    expect(sanitizeEventKeyword("Heard Craig Center for the Arts & Museum")).toBe(
      "Heard Craig Center for the Arts & Museum",
    )
  })
  it("caps length at 100", () => {
    expect(sanitizeEventKeyword("x".repeat(200))).toHaveLength(100)
  })
  it("leaves a clean keyword unchanged", () => {
    expect(sanitizeEventKeyword("events")).toBe("events")
  })
})
