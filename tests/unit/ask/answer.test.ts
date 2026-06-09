import { describe, it, expect } from "vitest"
import { buildAskPrompt, validateAnswer, answerQuestion, MAX_QUESTION_LEN, type AskContext } from "@/lib/ask/answer"

const ctx: AskContext = {
  restaurantName: "Wagyu House Atlanta",
  competitors: ["O-Ku", "Bachi Box"],
  insights: [{ type: "competitor.pricing", title: "O-Ku raised prices", summary: "O-Ku menu up 8%", dateKey: "2026-06-06" }],
  brief: { headline: "Saturday surge", deck: "Three events overlap your peak.", plays: ["Staff the rush"] },
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
