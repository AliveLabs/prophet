import { describe, it, expect } from "vitest"
import {
  parseVizContext,
  buildGeneratedInsightPrompt,
  generatedInsightType,
  GENERATED_INSIGHT_TYPE_PREFIX,
} from "@/lib/ai/generated-insight"
import { getSourceCategory } from "@/lib/insights/scoring"
import { lintVoice } from "@/lib/eval/voice-rules"

describe("parseVizContext", () => {
  it("parses a JSON string (the ?generate= form)", () => {
    const viz = parseVizContext(JSON.stringify({ domain: "weather", metric: "Avg high", value: 72, unit: "°F" }))
    expect(viz).not.toBeNull()
    expect(viz?.domain).toBe("weather")
    expect(viz?.metric).toBe("Avg high")
    expect(viz?.value).toBe("72")
    expect(viz?.unit).toBe("°F")
  })

  it("parses an already-parsed object", () => {
    const viz = parseVizContext({ domain: "social", metric: "Followers", entityName: "Rival Co" })
    expect(viz?.domain).toBe("social")
    expect(viz?.entityName).toBe("Rival Co")
  })

  it("rejects an unknown domain", () => {
    expect(parseVizContext({ domain: "nonsense", metric: "x" })).toBeNull()
  })

  it("rejects a missing metric", () => {
    expect(parseVizContext({ domain: "weather" })).toBeNull()
  })

  it("rejects malformed JSON and non-objects", () => {
    expect(parseVizContext("{not json")).toBeNull()
    expect(parseVizContext(42)).toBeNull()
    expect(parseVizContext(null)).toBeNull()
  })

  it("length-caps long fields (cost + injection surface)", () => {
    const viz = parseVizContext({ domain: "traffic", metric: "x".repeat(500) })
    expect((viz?.metric.length ?? 0) <= 160).toBe(true)
  })

  it("keeps locationId out of the prompt-bound fields and short", () => {
    const viz = parseVizContext({ domain: "traffic", metric: "Busiest", locationId: "l".repeat(200) })
    expect((viz?.locationId?.length ?? 0) <= 64).toBe(true)
  })
})

describe("generatedInsightType", () => {
  it("is prefixed user_viz, carries the domain, and stays distinct per id", () => {
    const t = generatedInsightType("weather", "ab12cd34")
    expect(t.startsWith(GENERATED_INSIGHT_TYPE_PREFIX)).toBe(true)
    expect(t).toBe("user_viz.weather.ab12cd34")
    expect(generatedInsightType("weather", "ab12cd34")).not.toBe(generatedInsightType("weather", "ff99ee00"))
  })

  it("always matches the home-hero guard's `user_viz%` pattern", () => {
    for (const d of ["weather", "social", "events", "traffic", "competitors", "content"] as const) {
      expect(generatedInsightType(d, "00000000").startsWith("user_viz")).toBe(true)
    }
  })
})

describe("getSourceCategory routes user_viz by its domain (honest source chip)", () => {
  it("maps each domain to the closest category", () => {
    expect(getSourceCategory("user_viz.social.x", null)).toBe("social")
    expect(getSourceCategory("user_viz.events.x", null)).toBe("events")
    expect(getSourceCategory("user_viz.traffic.x", null)).toBe("traffic")
    expect(getSourceCategory("user_viz.weather.x", null)).toBe("traffic")
    expect(getSourceCategory("user_viz.content.x", null)).toBe("content")
    expect(getSourceCategory("user_viz.visibility.x", null)).toBe("seo")
    expect(getSourceCategory("user_viz.competitors.x", null)).toBe("competitors")
    expect(getSourceCategory("user_viz.overview.x", null)).toBe("competitors")
  })

  it("does not mistake real engine types for user_viz", () => {
    expect(getSourceCategory("social.follower_spike", null)).toBe("social")
    expect(getSourceCategory("events.upcoming", null)).toBe("events")
  })
})

describe("buildGeneratedInsightPrompt", () => {
  it("grounds the prompt in the data point and forbids kitchen lingo", () => {
    const prompt = buildGeneratedInsightPrompt({ domain: "weather", metric: "Avg high", value: "72", unit: "°F", timeframe: "this week" })
    expect(prompt).toContain("Avg high")
    expect(prompt).toContain("72°F")
    expect(prompt).toContain("this week")
    // explicitly bans the kitchen lingo the voice gate enforces
    expect(prompt).toContain("Never use the words")
    // instructs honesty (medium/low, never high)
    expect(prompt).toContain('"medium" | "low"')
  })

  it("the static prompt copy itself carries no banned em dashes", () => {
    const prompt = buildGeneratedInsightPrompt({ domain: "traffic", metric: "Busiest competitor", entityName: "Rival" })
    // lintVoice flags em/en dashes; the prompt is ASCII-hyphen only.
    const emDash = lintVoice(prompt).filter((v) => v.kind === "em_dash")
    expect(emDash).toEqual([])
  })
})
