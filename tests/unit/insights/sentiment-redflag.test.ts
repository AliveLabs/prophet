import { describe, it, expect } from "vitest"
import { reviewInsightsFromSentiment } from "@/lib/insights/reviews/sentiment"
import type { ReviewSentiment } from "@/lib/insights/dossier/types"

function sentimentWith(theme: Partial<ReviewSentiment["themes"][number]>): ReviewSentiment {
  return {
    source: "google_places",
    windowDays: 90,
    themes: [
      {
        theme: theme.theme ?? "food",
        sentiment: theme.sentiment ?? "negative",
        mentions: theme.mentions ?? 3,
        examples: theme.examples ?? [],
      },
    ],
  }
}

describe("reviewInsightsFromSentiment — T5(c) red-flag severity", () => {
  it('"we all got food poisoning" → critical + red_flag evidence key', () => {
    const sentiment = sentimentWith({
      theme: "food quality",
      sentiment: "negative",
      examples: ["we all got food poisoning after eating here"],
    })
    const [insight] = reviewInsightsFromSentiment(sentiment)
    expect(insight.severity).toBe("critical")
    expect(insight.evidence.red_flag).toBe(true)
  })

  it('"the fries were soggy" → warning, no red_flag key', () => {
    const sentiment = sentimentWith({
      theme: "food quality",
      sentiment: "negative",
      examples: ["the fries were soggy and cold"],
    })
    const [insight] = reviewInsightsFromSentiment(sentiment)
    expect(insight.severity).toBe("warning")
    expect(insight.evidence.red_flag).toBeUndefined()
  })

  it("matches other illness/safety phrases exactly (case-insensitive)", () => {
    const phrases = [
      "the HEALTH DEPARTMENT should know about this",
      "I threw up an hour later",
      "found a roach in my salad",
      "this place needs a health inspector",
    ]
    for (const example of phrases) {
      const sentiment = sentimentWith({ sentiment: "negative", examples: [example] })
      const [insight] = reviewInsightsFromSentiment(sentiment)
      expect(insight.severity, `expected critical for: ${example}`).toBe("critical")
      expect(insight.evidence.red_flag).toBe(true)
    }
  })

  it("matches discrimination phrases exactly", () => {
    const sentiment = sentimentWith({
      sentiment: "negative",
      examples: ["the host was racist toward my family"],
    })
    const [insight] = reviewInsightsFromSentiment(sentiment)
    expect(insight.severity).toBe("critical")
    expect(insight.evidence.red_flag).toBe(true)
  })

  it("does NOT flag a positive theme even if it mentions a listed phrase (negative-only gate)", () => {
    const sentiment = sentimentWith({
      sentiment: "positive",
      examples: ["the health department gave us an A rating and the food was great"],
    })
    const [insight] = reviewInsightsFromSentiment(sentiment)
    expect(insight.severity).toBe("info")
    expect(insight.evidence.red_flag).toBeUndefined()
  })

  it("does NOT flag a mixed theme (negative-only gate; mixed is already 'info' by existing convention)", () => {
    const sentiment = sentimentWith({
      sentiment: "mixed",
      examples: ["food poisoning risk seemed low but service was slow"],
    })
    const [insight] = reviewInsightsFromSentiment(sentiment)
    expect(insight.severity).toBe("info")
    expect(insight.evidence.red_flag).toBeUndefined()
  })

  it("does not fuzzy-match a near-miss phrase (prefer misses over false alarms)", () => {
    const sentiment = sentimentWith({
      sentiment: "negative",
      examples: ["I felt a little unwell after the big meal, probably just full"],
    })
    const [insight] = reviewInsightsFromSentiment(sentiment)
    expect(insight.severity).toBe("warning")
    expect(insight.evidence.red_flag).toBeUndefined()
  })

  it("no type change needed — GeneratedInsight.severity already allows critical", () => {
    const sentiment = sentimentWith({ sentiment: "negative", examples: ["we got sick"] })
    const [insight] = reviewInsightsFromSentiment(sentiment)
    const allowed: Array<typeof insight.severity> = ["info", "warning", "critical"]
    expect(allowed).toContain(insight.severity)
  })
})
