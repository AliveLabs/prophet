import { describe, expect, it } from "vitest"
import { buildAskQuestion } from "@/components/ticket/viz-tbubble"

// ALT-257: the Listing Check ingress feeds `buildAskQuestion`, whose default branch
// splices the metric and value into "What does my {metric} of {value} mean ...". That
// template is easy to write an unreadable question against: a value of "8 of 12" comes
// out as "of 8 of 12". These lock the two strings the module actually passes, so a later
// edit to either the metric wording or the template gets caught here rather than shipping
// a garbled question into /ask.

const LEAD_SPLIT = {
  domain: "content",
  metric: "Listing photo mix",
  value: "8 customer uploads out of 12",
  entityType: "location",
  source: "Business listing data",
} as const

const LEAD_NO_SPLIT = {
  domain: "content",
  metric: "Listing photo count",
  value: 12,
  entityType: "location",
  source: "Business listing data",
} as const

const COVERAGE = {
  domain: "content",
  metric: "Listing photo coverage",
  value: "3 essentials covered out of 8",
  entityType: "location",
  source: "Business listing data",
} as const

describe("Listing Check Ask ingress questions", () => {
  it("phrases the owner-vs-customer mix as a readable sentence", () => {
    expect(buildAskQuestion(LEAD_SPLIT)).toBe(
      "What does my listing photo mix of 8 customer uploads out of 12 mean for my business, and what should I do about it?",
    )
  })

  it("phrases the plain photo count when the owner split isn't available", () => {
    expect(buildAskQuestion(LEAD_NO_SPLIT)).toBe(
      "What does my listing photo count of 12 mean for my business, and what should I do about it?",
    )
  })

  it("phrases the coverage read as a readable sentence", () => {
    expect(buildAskQuestion(COVERAGE)).toBe(
      "What does my listing photo coverage of 3 essentials covered out of 8 mean for my business, and what should I do about it?",
    )
  })

  it("never doubles the 'of' the template already supplies", () => {
    // The trap this guards: value "8 of 12" would render "... of 8 of 12 mean ...".
    for (const viz of [LEAD_SPLIT, LEAD_NO_SPLIT, COVERAGE]) {
      expect(buildAskQuestion(viz)).not.toMatch(/of \d+ of \d+/)
    }
  })

  it("stays free of restaurant and kitchen lingo", () => {
    // Mirrors the CHEF_LINGO rule: these are operator-facing strings.
    const banned = /\b(kitchen|chef|plate|plating|menu engineering|covers|BOH|FOH)\b/i
    for (const viz of [LEAD_SPLIT, LEAD_NO_SPLIT, COVERAGE]) {
      expect(buildAskQuestion(viz)).not.toMatch(banned)
    }
  })
})
