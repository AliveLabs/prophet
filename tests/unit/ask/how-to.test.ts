import { describe, it, expect } from "vitest"
import {
  isHowToQuestion,
  matchHowTo,
  buildHowToPrompt,
  answerHowTo,
} from "@/lib/ask/how-to"

describe("ask/how-to — intent routing", () => {
  it("classifies platform how-to questions as how-to", () => {
    expect(isHowToQuestion("How do I add a competitor's social handle?")).toBe(true)
    expect(isHowToQuestion("How do I invite my manager?")).toBe(true)
    expect(isHowToQuestion("Where do I manage billing?")).toBe(true)
    expect(isHowToQuestion("how to pin a question so it re-runs every morning")).toBe(true)
    expect(isHowToQuestion("How do I add a competitor?")).toBe(true)
  })

  it("does NOT hijack market questions (the load-bearing guard)", () => {
    expect(isHowToQuestion("Who's undercutting me right now?")).toBe(false)
    expect(isHowToQuestion("What changed this week?")).toBe(false)
    expect(isHowToQuestion("Which competitor is gaining on social?")).toBe(false)
    expect(isHowToQuestion("How is my rating trending?")).toBe(false)
    expect(isHowToQuestion("What should I prep before the weekend?")).toBe(false)
    expect(isHowToQuestion("")).toBe(false)
  })

  it("ranks the right KB entry for a question", () => {
    const m = matchHowTo("How do I add a competitor's social handle?")
    expect(m.length).toBeGreaterThan(0)
    expect(m[0].entry.id).toBe("add-competitor-social-handle")
  })

  it("builds a KB-grounded prompt that bans invented UI", () => {
    const m = matchHowTo("How do I invite teammates?")
    const { system, prompt } = buildHowToPrompt("How do I invite teammates?", m)
    expect(system).toMatch(/ONLY the provided help entries/i)
    expect(system).toMatch(/NEVER invent/i)
    expect(prompt).toContain("Settings")
    expect(prompt).toContain("Invite")
  })

  it("returns the validated KB answer from the transport", async () => {
    const ans = await answerHowTo("How do I add a competitor?", {
      transport: async () => ({
        answer: "Open Competitors and use Add competitor.",
        confidence: "high",
        sources: ["Competitors"],
        grounded: true,
      }),
    })
    expect(ans.answer).toMatch(/Add competitor/)
    expect(ans.grounded).toBe(true)
  })

  it("falls back to the top KB entry (grounded) when the transport throws", async () => {
    const ans = await answerHowTo("How do I add a competitor?", {
      transport: async () => {
        throw new Error("down")
      },
    })
    expect(ans.grounded).toBe(true)
    expect(ans.answer).toMatch(/Competitors/)
  })
})
