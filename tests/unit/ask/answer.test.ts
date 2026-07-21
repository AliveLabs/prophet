import { describe, it, expect } from "vitest"
import { buildAskPrompt, busiestProfile, validateAnswer, answerQuestion, MAX_QUESTION_LEN, type AskContext } from "@/lib/ask/answer"

const ctx: AskContext = {
  restaurantName: "Wagyu House Atlanta",
  competitors: ["O-Ku", "Bachi Box"],
  insights: [{ type: "competitor.pricing", title: "O-Ku raised prices", summary: "O-Ku menu up 8%", dateKey: "2026-06-06" }],
  brief: { headline: "Saturday surge", deck: "Three events overlap your peak.", plays: ["Staff the rush"] },
  busy: {
    you: { name: "Wagyu House Atlanta", busiestDay: "Saturday", peakHour: "7pm" },
    competitors: [{ name: "O-Ku", busiestDay: "Friday", peakHour: "8pm" }],
  },
}

describe("ask/answer — domain-locked grounded Q&A", () => {
  it("builds a domain-locked prompt that embeds the data and bans outside knowledge", () => {
    const { system, prompt } = buildAskPrompt(ctx, "Who raised prices?")
    expect(system).toMatch(/ONLY the DATA/i)
    expect(system).toMatch(/NEVER use outside knowledge/i)
    expect(prompt).toContain("O-Ku")
    expect(prompt).toContain("Who raised prices?")
    expect(prompt).toContain("Saturday surge")
  })

  it("embeds the who's-busy patterns so Ask can answer them off-screen (ALT-368)", () => {
    const { prompt } = buildAskPrompt(ctx, "When are my competitors busiest?")
    expect(prompt).toMatch(/Busy patterns/i)
    expect(prompt).toContain("busiest on Saturday")
    expect(prompt).toContain("peaks around 7pm")
    expect(prompt).toContain("O-Ku: busiest on Friday, peaks around 8pm")
  })

  it("omits the busy section entirely when there's no readable curve", () => {
    const { prompt } = buildAskPrompt({ ...ctx, busy: { you: null, competitors: [] } }, "q")
    expect(prompt).not.toMatch(/Busy patterns/i)
  })

  it("busiestProfile picks the highest-scoring day + hour, and stays null on empty data", () => {
    const p = busiestProfile("Spot", [
      { day_of_week: 5, peak_hour: 12, peak_score: 40 },
      { day_of_week: 6, peak_hour: 19, peak_score: 90 },
    ])
    expect(p).toEqual({ name: "Spot", busiestDay: "Saturday", peakHour: "7pm" })
    expect(busiestProfile("Spot", [])).toEqual({ name: "Spot", busiestDay: null, peakHour: null })
    expect(busiestProfile("Spot", [{ day_of_week: 1, peak_hour: 0, peak_score: 0 }])).toEqual({
      name: "Spot",
      busiestDay: null,
      peakHour: null,
    })
  })

  it("caps question length in the prompt", () => {
    const { prompt } = buildAskPrompt(ctx, "a".repeat(500))
    expect(prompt).not.toContain("a".repeat(MAX_QUESTION_LEN + 1))
  })

  it("validates + coerces model output", () => {
    expect(validateAnswer({ answer: "Yes.", confidence: "high", sources: ["Reviews"], grounded: true })?.answer).toBe("Yes.")
    expect(validateAnswer({ answer: "", confidence: "high" })).toBeNull()
    const coerced = validateAnswer({ answer: "x", confidence: "bogus", sources: "nope" })
    expect(coerced?.confidence).toBe("medium")
    expect(coerced?.sources).toEqual([])
    expect(coerced?.grounded).toBe(true)
  })

  it("returns the validated answer from the transport", async () => {
    const ans = await answerQuestion(ctx, "Who raised prices?", {
      transport: async () => ({ answer: "O-Ku raised prices 8%.", confidence: "high", sources: ["Competitor: O-Ku"], grounded: true }),
    })
    expect(ans.answer).toMatch(/O-Ku/)
    expect(ans.grounded).toBe(true)
  })

  it("falls back gracefully (ungrounded, low confidence) when the transport throws", async () => {
    const ans = await answerQuestion(ctx, "x", { transport: async () => { throw new Error("down") } })
    expect(ans.grounded).toBe(false)
    expect(ans.confidence).toBe("low")
  })
})
