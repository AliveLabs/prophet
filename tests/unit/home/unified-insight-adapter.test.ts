// The play → UnifiedInsight adapter. Every test here pins an HONESTY rule, because the
// failure mode this module guards against is not a crash — it is a card that quietly
// claims something the play cannot back.

import { describe, it, expect } from "vitest"
import {
  whenTagFor,
  validationLine,
  planStepsFor,
  playToUnifiedInsight,
} from "@/app/(dashboard)/home/unified-insight-adapter"
import { countableDomain } from "@/app/(dashboard)/home/unified-insight-adapter"
import { insightTier, planSummary } from "@/components/insights/unified-insight-card"
import type { EnrichedRecommendation, RecipeStep } from "@/lib/skills/types"

const TODAY = "2026-07-30" // a Thursday

function step(over: Partial<RecipeStep> = {}): RecipeStep {
  return {
    channel: "GOOGLE_BUSINESS_PROFILE",
    platforms: ["GOOGLE_BUSINESS"],
    audience: "weekend brunch regulars",
    window: { note: "before Saturday service" },
    ...over,
  }
}

function play(over: Partial<EnrichedRecommendation> = {}): EnrichedRecommendation {
  return {
    title: "Post the patio before the weekend",
    rationale: "Two rivals are pushing patio photos and you are not.",
    skillId: "social-counter",
    ownerRole: "marketing",
    kind: "capitalize",
    recipe: [step()],
    confidence: "high",
    evidenceRefs: ["social.post:rival-patio"],
    knowledgeVersion: "v1",
    ...over,
  }
}

describe("whenTagFor — a timing claim needs a real date", () => {
  it("emits nothing without a window", () => {
    expect(whenTagFor(undefined, TODAY)).toBeNull()
  })

  it("emits nothing when the window carries only a prose note (no dates)", () => {
    expect(whenTagFor({}, TODAY)).toBeNull()
  })

  it("marks today and tomorrow as the soonest tier", () => {
    expect(whenTagFor({ start: "2026-07-30" }, TODAY)).toEqual({ axis: "when", label: "Today", urgent: true })
    expect(whenTagFor({ start: "2026-07-31" }, TODAY)).toEqual({ axis: "when", label: "Tomorrow", urgent: true })
  })

  it("names the weekday inside the week, urgent only through the day after tomorrow", () => {
    expect(whenTagFor({ start: "2026-08-01" }, TODAY)).toEqual({ axis: "when", label: "By Saturday", urgent: true })
    expect(whenTagFor({ start: "2026-08-04" }, TODAY)).toEqual({ axis: "when", label: "By Tuesday", urgent: false })
  })

  it("falls back to a date beyond the week, never urgent", () => {
    expect(whenTagFor({ start: "2026-08-20" }, TODAY)).toEqual({ axis: "when", label: "From Aug 20" })
  })

  it("says nothing about a window that has already closed", () => {
    // The start is in the past AND the end has passed: this makes no claim about the future,
    // so "Today" would be a lie of convenience.
    expect(whenTagFor({ start: "2026-07-20", end: "2026-07-25" }, TODAY)).toBeNull()
  })

  it("still speaks for an open window that started in the past", () => {
    expect(whenTagFor({ start: "2026-07-28", end: "2026-08-05" }, TODAY)).toEqual({
      axis: "when",
      label: "Today",
      urgent: true,
    })
  })
})

describe("countableDomain — the denominated line has to be grammatical", () => {
  it("pluralizes a singular category word", () => {
    // domainLabel() returns "Review", which read as a typo in "3 of 20 review".
    expect(countableDomain("Review")).toBe("reviews")
  })
  it("leaves an already-plural label alone", () => {
    expect(countableDomain("Events")).toBe("events")
  })
  it("gives an acronym a noun instead of an s", () => {
    expect(countableDomain("SEO")).toBe("SEO signals")
  })
  it("falls back rather than emitting an empty subject", () => {
    expect(countableDomain("")).toBe("signals we read")
  })
})

describe("validationLine — denominated or absent", () => {
  it("is absent when the play cites no rate, estimate or comparison", () => {
    expect(validationLine(play())).toBeNull()
  })

  it("prefers a real rate, keeps its denominator, and reads as a sentence", () => {
    expect(
      validationLine(
        play({ evidence: [{ source: "review.theme:slow-service", rate: { numerator: 3, denominator: 20, pct: 15 } }] }),
      ),
    ).toBe("Based on 3 of 20 reviews.")
  })

  it("flags an estimate as estimated", () => {
    const line = validationLine(
      play({
        presentation: {
          estimate: { value: "roughly 1 in 25 visitors", unit: "range", basis: "your review volume", isEstimated: true },
        },
      }),
    )
    expect(line).toBe("Estimated roughly 1 in 25 visitors, based on your review volume")
  })

  it("never emits an em dash", () => {
    const lines = [
      validationLine(play({ evidence: [{ source: "review.theme:x", rate: { numerator: 3, denominator: 20, pct: 15 } }] })),
      validationLine(play({ presentation: { estimate: { value: "1 in 25", unit: "range", basis: "your volume", isEstimated: true } } })),
    ]
    for (const line of lines) expect(line).not.toContain("—")
  })

  it("falls back to a head-to-head comparison last", () => {
    expect(
      validationLine(
        play({
          presentation: {
            headToHead: [
              { metric: "review velocity", you: "12 a week", setOrCompetitor: "6 a week", lead: "you", label: "You earn reviews about twice as fast as the set." },
            ],
          },
        }),
      ),
    ).toBe("You earn reviews about twice as fast as the set.")
  })

  it("never surfaces a confidence or impact score as prose", () => {
    const line = validationLine(play({ combinedScore: 87, confidence: "high" })) ?? ""
    expect(line).not.toMatch(/\b87\b/)
  })
})

describe("planStepsFor", () => {
  it("humanizes channel and platform tokens", () => {
    const [s] = planStepsFor(play())
    expect(s.channel).toBe("Google Business Profile")
    expect(s.platforms).toEqual(["Google Business"])
  })

  it("carries the window NOTE as the readable timing, not the raw dates", () => {
    expect(planStepsFor(play())[0].window).toBe("before Saturday service")
  })

  it("drops empty optional fields rather than rendering blank rows", () => {
    const [s] = planStepsFor(play({ recipe: [step({ audience: "", offer: "", window: { note: "" } })] }))
    expect(s.audience).toBeUndefined()
    expect(s.offer).toBeUndefined()
    expect(s.window).toBeUndefined()
  })

  it("keeps step dependencies", () => {
    const [s] = planStepsFor(play({ recipe: [step({ dependencies: ["a wallet pass exists"] })] }))
    expect(s.dependencies).toEqual(["a wallet pass exists"])
  })
})

describe("playToUnifiedInsight", () => {
  it("a play with a recipe is the PLAN tier", () => {
    const insight = playToUnifiedInsight(play(), { todayKey: TODAY, id: "k1" })
    expect(insightTier(insight)).toBe("plan")
  })

  it("a play with an EMPTY recipe is an observation, never a plan with no plan", () => {
    const insight = playToUnifiedInsight(play({ recipe: [] }), { todayKey: TODAY, id: "k1" })
    expect(insight.plan).toBeUndefined()
    expect(insight.suggestion).toBeNull()
    expect(insightTier(insight)).toBe("observation")
  })

  it("always carries a `what` tag and only adds `state` when the surface asks", () => {
    const bare = playToUnifiedInsight(play(), { todayKey: TODAY, id: "k1" })
    expect(bare.tags.filter((t) => t.axis === "what")).toHaveLength(1)
    expect(bare.tags.some((t) => t.axis === "state")).toBe(false)

    const framed = playToUnifiedInsight(play(), { todayKey: TODAY, id: "k1", stateLabel: "Top this week" })
    expect(framed.tags).toContainEqual({ axis: "state", label: "Top this week" })
  })

  it("carries the timing tag off the EARLIEST recipe window", () => {
    const insight = playToUnifiedInsight(
      play({
        recipe: [
          step({ window: { start: "2026-08-10", note: "later" } }),
          step({ window: { start: "2026-07-31", note: "first" } }),
        ],
      }),
      { todayKey: TODAY, id: "k1" },
    )
    expect(insight.tags).toContainEqual({ axis: "when", label: "Tomorrow", urgent: true })
  })

  it("renders both score axes as LEVEL words, with no numerals anywhere", () => {
    const insight = playToUnifiedInsight(play({ combinedScore: 87 }), { todayKey: TODAY, id: "k1" })
    expect(insight.confidence).toBe("high")
    expect(["high", "medium", "low"]).toContain(insight.impact)
    // The whole card payload is numeral-free except denominated evidence, which this play has none of.
    const prose = [insight.title, insight.why, insight.validation ?? "", ...(insight.whyPoints ?? [])].join(" ")
    expect(prose).not.toMatch(/\b87\b/)
  })

  it("omits the details link when the surface has no detail page", () => {
    expect(playToUnifiedInsight(play(), { todayKey: TODAY, id: "k1" }).detailHref).toBeUndefined()
  })

  it("summarizes the plan without mangling a brand name mid-sentence", () => {
    // The regression this pins: an earlier planSummary lowercased the first letter of every
    // channel after the first, producing "google Business Profile".
    const insight = playToUnifiedInsight(
      play({
        recipe: [step({ channel: "PAID_SOCIAL" }), step({ channel: "GOOGLE_BUSINESS_PROFILE" })],
      }),
      { todayKey: TODAY, id: "k1" },
    )
    const summary = planSummary(insight.plan!)
    expect(summary).toBe("Two steps: Paid Social and Google Business Profile.")
    expect(summary).not.toContain("google")
  })

  it("uses count WORDS in the plan summary, so no numeral reaches the card", () => {
    const one = playToUnifiedInsight(play({ recipe: [step()] }), { todayKey: TODAY, id: "k1" })
    expect(planSummary(one.plan!)).toMatch(/^One step:/)
    expect(planSummary(one.plan!)).not.toMatch(/\d/)
  })
})
