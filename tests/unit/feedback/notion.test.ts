import { describe, it, expect } from "vitest"
import { ticketTitle, ticketType } from "@/lib/feedback/notion"

// The two pure decisions in the Notion mapping. Both look trivial and both have a
// failure mode that reaches a human: a title that is a wall of text is unreadable in a
// list view, and a mistyped ticket lands in the wrong queue.

describe("ticketTitle", () => {
  it("keeps a short single-line report verbatim", () => {
    const msg = "The systems says we are watching 5 competitors but only show three business names."
    expect(ticketTitle(msg)).toBe(msg)
  })

  it("takes only the FIRST non-empty line, because Notion titles are single-line", () => {
    expect(ticketTitle("Weather card is wrong\n\nIt says four days of rain")).toBe(
      "Weather card is wrong"
    )
  })

  it("skips leading blank lines rather than titling a report an empty string", () => {
    expect(ticketTitle("\n\n  Images are missing")).toBe("Images are missing")
  })

  it("collapses the internal whitespace an operator pasted in", () => {
    expect(ticketTitle("too    many\tspaces")).toBe("too many spaces")
  })

  it("clips on a word boundary and marks the elision", () => {
    const long = "The reputation box states there are two reviews but only shows one of them inside The Plan section which is confusing"
    const out = ticketTitle(long)
    expect(out.length).toBeLessThanOrEqual(91)
    expect(out.endsWith("…")).toBe(true)
    // Never cut mid-word: the character before the ellipsis is the end of a word.
    expect(out).not.toMatch(/\s…$/)
    expect(long.startsWith(out.slice(0, -1))).toBe(true)
  })

  it("never returns an empty title", () => {
    expect(ticketTitle("   ")).toBe("Beta feedback")
    expect(ticketTitle("")).toBe("Beta feedback")
  })
})

describe("ticketType", () => {
  it("maps idea-shaped categories to Feature", () => {
    for (const c of ["idea", "Idea", "feature", "request"]) {
      expect(ticketType(c)).toBe("Feature")
    }
  })

  it("maps praise and questions to Task", () => {
    expect(ticketType("praise")).toBe("Task")
    expect(ticketType("question")).toBe("Task")
  })

  it("defaults an ABSENT or unknown category to Bug, not Task", () => {
    // Deliberate bias: an operator who bothers to report during a beta is usually
    // reporting a problem. A mistyped bug gets noticed and retyped; a mistyped task
    // sits in a backlog. Four of Chris's seven 2026-08-17 reports had NO category.
    expect(ticketType(null)).toBe("Bug")
    expect(ticketType("")).toBe("Bug")
    expect(ticketType("issue")).toBe("Bug")
    expect(ticketType("something-we-add-later")).toBe("Bug")
  })
})
