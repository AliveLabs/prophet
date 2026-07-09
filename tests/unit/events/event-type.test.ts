import { describe, it, expect } from "vitest"
import { classifyEventType } from "@/lib/events/relevance"

describe("classifyEventType", () => {
  it("classifies pro/college sports and races as sports", () => {
    expect(classifyEventType({ title: "Texas Rangers vs Houston Astros" })).toBe("sports")
    expect(classifyEventType({ title: "NCAA Men's Basketball Championship" })).toBe("sports")
    expect(classifyEventType({ title: "Cowtown Marathon" })).toBe("sports")
  })

  it("classifies concerts and tours", () => {
    expect(classifyEventType({ title: "Fuerza Regida in Concert" })).toBe("concert")
    expect(classifyEventType({ title: "Morgan Wallen 2026 Tour" })).toBe("concert")
  })

  it("classifies festivals, conferences, theater, family, community", () => {
    expect(classifyEventType({ title: "Main Street Arts Festival" })).toBe("festival")
    expect(classifyEventType({ title: "Texas Restaurant Convention & Expo" })).toBe("conference")
    expect(classifyEventType({ title: "Hamilton (Broadway musical)" })).toBe("theater")
    expect(classifyEventType({ title: "Disney On Ice" })).toBe("family")
    expect(classifyEventType({ title: "Downtown Holiday Parade" })).toBe("community")
  })

  it("uses the venue name as a signal too", () => {
    expect(classifyEventType({ title: "An Evening With...", venue: { name: "Winspear Opera House" } })).toBe("theater")
  })

  it("falls back to other when unsure", () => {
    expect(classifyEventType({ title: "Grand Opening" })).toBe("other")
    expect(classifyEventType({ title: undefined })).toBe("other")
  })
})
