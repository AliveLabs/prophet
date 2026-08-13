// The insights row → UnifiedInsight adapter. Every test here pins an HONESTY rule (the
// same posture as tests/unit/home/unified-insight-adapter.test.ts): the failure mode this
// module guards against is not a crash — it is a card that quietly claims something the
// stored row cannot back.

import { describe, it, expect } from "vitest"
import {
  insightRowToUnifiedInsight,
  insightKeptState,
} from "@/app/(dashboard)/insights/insight-row-adapter"
import { insightTier } from "@/components/insights/unified-insight-card"
import type { FeedInsight } from "@/app/(dashboard)/insights/insights-map"

function row(over: Partial<FeedInsight> = {}): FeedInsight {
  return {
    id: "i1",
    title: "A rival's review pace doubled this month",
    summary: "They collected 14 reviews in two weeks against their usual 6.",
    insightType: "review.spike",
    competitorId: "c1",
    confidence: "high",
    severity: "warning",
    status: "new",
    userFeedback: null,
    relevanceScore: 60,
    urgencyLevel: "warning",
    suppressed: false,
    evidence: {},
    recommendations: [],
    subjectLabel: "Rival Co",
    dateKey: "2026-08-01",
    ...over,
  }
}

const REC = { title: "Ask happy regulars for a quick review", rationale: "You have momentum." }

describe("tier is DERIVED from recommendations, never stored", () => {
  it("a row with recommendations is the SUGGESTION tier", () => {
    const insight = insightRowToUnifiedInsight(row({ recommendations: [REC] }))
    expect(insightTier(insight)).toBe("suggestion")
  })

  it("a row with no recommendations is an OBSERVATION", () => {
    const insight = insightRowToUnifiedInsight(row())
    expect(insight.suggestion).toBeNull()
    expect(insightTier(insight)).toBe("observation")
  })

  it("a titleless recommendation is no recommendation — the card cannot promise a blank step", () => {
    const insight = insightRowToUnifiedInsight(row({ recommendations: [{ rationale: "why" }] }))
    expect(insight.suggestion).toBeNull()
    expect(insightTier(insight)).toBe("observation")
  })

  it("NEVER the plan tier: a row's recommendation has no steps, so `plan` stays undefined", () => {
    const insight = insightRowToUnifiedInsight(
      row({ recommendations: [REC, { title: "Second idea" }] }),
    )
    expect(insight.plan).toBeUndefined()
    expect(insightTier(insight)).not.toBe("plan")
  })

  it("the suggestion line is the FIRST recommendation's title, verbatim", () => {
    const insight = insightRowToUnifiedInsight(
      row({ recommendations: [REC, { title: "Second idea" }] }),
    )
    expect(insight.suggestion).toBe("Ask happy regulars for a quick review")
  })
})

describe("scores are word LEVELS — no numerals reach the card", () => {
  it("maps confidence high/medium straight across and folds low to directional", () => {
    expect(insightRowToUnifiedInsight(row({ confidence: "high" })).confidence).toBe("high")
    expect(insightRowToUnifiedInsight(row({ confidence: "medium" })).confidence).toBe("medium")
    expect(insightRowToUnifiedInsight(row({ confidence: "low" })).confidence).toBe("directional")
  })

  it("maps severity onto the impact axis", () => {
    expect(insightRowToUnifiedInsight(row({ severity: "critical" })).impact).toBe("high")
    expect(insightRowToUnifiedInsight(row({ severity: "warning" })).impact).toBe("medium")
    expect(insightRowToUnifiedInsight(row({ severity: "info" })).impact).toBe("low")
  })

  it("the relevance score ranks but never renders — the 'Fit 74' regression", () => {
    const insight = insightRowToUnifiedInsight(row({ relevanceScore: 74 }))
    const prose = [
      insight.title,
      insight.why,
      insight.validation ?? "",
      insight.suggestion ?? "",
      ...insight.tags.map((t) => t.label),
      ...(insight.whyPoints ?? []),
    ].join(" ")
    expect(prose).not.toMatch(/\b74\b/)
    expect(prose).not.toMatch(/\bFit\b/)
  })
})

describe("honest gating of the optional fields", () => {
  it("the validation line is absent: a detector row cites no denominated rate", () => {
    expect(insightRowToUnifiedInsight(row()).validation).toBeNull()
  })

  it("no `when` chip ever — a row carries no window date to back a timing claim", () => {
    const insight = insightRowToUnifiedInsight(row({ urgencyLevel: "critical" }))
    expect(insight.tags.some((t) => t.axis === "when")).toBe(false)
  })

  it("exactly one `what` tag, carrying the operator-facing source label", () => {
    const whatTags = insightRowToUnifiedInsight(row()).tags.filter((t) => t.axis === "what")
    expect(whatTags).toHaveLength(1)
    expect(whatTags[0].label).toBe("Google Business Profile")
  })

  it("a just-generated row gets a `state` tag; a normal row gets none", () => {
    expect(insightRowToUnifiedInsight(row({ justGenerated: true })).tags).toContainEqual({
      axis: "state",
      label: "Just generated",
    })
    expect(insightRowToUnifiedInsight(row()).tags.some((t) => t.axis === "state")).toBe(false)
  })

  it("no detail link: this surface has no per-row detail page to promise", () => {
    expect(insightRowToUnifiedInsight(row()).detailHref).toBeUndefined()
  })

  it("carries the summary as the why and keeps the title verbatim", () => {
    const insight = insightRowToUnifiedInsight(row())
    expect(insight.title).toBe("A rival's review pace doubled this month")
    expect(insight.why).toBe("They collected 14 reviews in two weeks against their usual 6.")
  })
})

describe("insightKeptState — the Keep/Dismiss read of the lifecycle status", () => {
  it("reads todo (what Keep writes) and the legacy Track positives as kept", () => {
    expect(insightKeptState("todo")).toBe(true)
    expect(insightKeptState("read")).toBe(true)
    expect(insightKeptState("actioned")).toBe(true)
  })

  it("reads the cleared statuses as dismissed", () => {
    expect(insightKeptState("dismissed")).toBe(false)
    expect(insightKeptState("inaccurate")).toBe(false)
    expect(insightKeptState("snoozed")).toBe(false)
  })

  it("reads new (and anything unknown) as untouched", () => {
    expect(insightKeptState("new")).toBeNull()
    expect(insightKeptState("whatever")).toBeNull()
  })
})
