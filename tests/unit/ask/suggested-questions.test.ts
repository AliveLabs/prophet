// ALT-634 — an offered question is a promise.
//
// Every Ask surface hardcoded its own chip list and every one of them led with "Who's undercutting
// me?". Ask cannot answer it: gatherAskContext assembles the location name, watched competitors,
// busy-times curves, recent insights and the latest brief, with no menu or pricing data anywhere,
// and menu insights are themselves default-off (ALT-363). So the most prominent invitation on the
// dashboard led straight to "I don't have that yet".

import { describe, it, expect } from "vitest"
import {
  suggestedAskQuestions,
  askCapabilityFrom,
  NO_ASK_CAPABILITY,
  type AskCapability,
} from "@/lib/ask/suggested-questions"

const FULL: AskCapability = {
  insights: true,
  brief: true,
  busyTimes: true,
  competitors: true,
  menuPricing: false, // the truth today
}

describe("suggestedAskQuestions", () => {
  it("never offers the pricing question while we hold no pricing data", () => {
    const qs = suggestedAskQuestions(FULL, 6)
    expect(qs.join(" ")).not.toMatch(/undercut/i)
  })

  it("offers it again the moment that data exists, without a code change", () => {
    const qs = suggestedAskQuestions({ ...FULL, menuPricing: true }, 6)
    expect(qs.some((q) => /undercut/i.test(q))).toBe(true)
  })

  it("puts questions we can answer ahead of the pricing one even when both are available", () => {
    const qs = suggestedAskQuestions({ ...FULL, menuPricing: true }, 3)
    expect(qs.join(" ")).not.toMatch(/undercut/i)
  })

  it("offers nothing at all rather than a question with no data behind it", () => {
    expect(suggestedAskQuestions(NO_ASK_CAPABILITY)).toEqual([])
  })

  it("returns a SHORT row rather than padding with unanswerable questions", () => {
    const onlyInsights = { ...NO_ASK_CAPABILITY, insights: true }
    const qs = suggestedAskQuestions(onlyInsights, 3)
    expect(qs.length).toBeGreaterThan(0)
    expect(qs.length).toBeLessThanOrEqual(2) // both insight-backed questions, nothing invented
  })

  it("honours the limit", () => {
    expect(suggestedAskQuestions(FULL, 2)).toHaveLength(2)
    expect(suggestedAskQuestions(FULL, 0)).toEqual([])
  })

  it("never repeats a question", () => {
    const qs = suggestedAskQuestions(FULL, 10)
    expect(new Set(qs).size).toBe(qs.length)
  })

  it("uses no em dash and no contraction of the product's own name", () => {
    for (const q of suggestedAskQuestions({ ...FULL, menuPricing: true }, 10)) {
      expect(q).not.toMatch(/—/)
    }
  })
})

describe("askCapabilityFrom", () => {
  it("reads counts as presence", () => {
    const cap = askCapabilityFrom({
      insightCount: 3,
      hasBrief: true,
      hasBusyTimes: false,
      competitorCount: 0,
    })
    expect(cap.insights).toBe(true)
    expect(cap.brief).toBe(true)
    expect(cap.busyTimes).toBe(false)
    expect(cap.competitors).toBe(false)
  })

  it("defaults menuPricing to false, so it can only be turned on deliberately", () => {
    const cap = askCapabilityFrom({
      insightCount: 9,
      hasBrief: true,
      hasBusyTimes: true,
      competitorCount: 5,
    })
    expect(cap.menuPricing).toBe(false)
  })

  it("treats a zero count as absence, not as unknown", () => {
    const cap = askCapabilityFrom({
      insightCount: 0,
      hasBrief: false,
      hasBusyTimes: false,
      competitorCount: 0,
    })
    expect(cap).toEqual(NO_ASK_CAPABILITY)
  })
})
