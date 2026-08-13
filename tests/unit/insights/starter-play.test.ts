import { describe, it, expect } from "vitest"
import {
  parseStoredStarter,
  pickStarterPlay,
  starterNotReadyMessage,
  starterReadiness,
  starterSkill,
  type StarterSignalRead,
} from "@/lib/insights/starter-play"
import { reputationSkill } from "@/lib/skills/reputation/skill"
import type { EnrichedRecommendation } from "@/lib/skills/types"

function read(over: Partial<StarterSignalRead> = {}): StarterSignalRead {
  return { ruleOutputTypes: [], ownReviewThemeCount: 0, hasOwnListing: false, ...over }
}

const STEP = { channel: "google_business", platforms: [], audience: "guests", window: { note: "this week" } }

function play(over: Partial<EnrichedRecommendation> = {}): EnrichedRecommendation {
  return {
    title: "t",
    rationale: "r",
    skillId: "reputation",
    ownerRole: "owner",
    kind: "reputation",
    recipe: [],
    confidence: "medium",
    evidenceRefs: ["review.theme"],
    knowledgeVersion: "reputation@v2",
    ...over,
  } as EnrichedRecommendation
}

describe("starterSkill", () => {
  it("IS reputation, so skillHealth and spend attribute to the same expert as the nightly run", () => {
    expect(starterSkill.id).toBe(reputationSkill.id)
    expect(starterSkill.knowledgeVersion).toBe(reputationSkill.knowledgeVersion)
    expect(starterSkill.tier).toBe(reputationSkill.tier)
    expect(starterSkill.temperature).toBe(reputationSkill.temperature)
    expect(starterSkill.parse).toBe(reputationSkill.parse)
    expect(starterSkill.fallback).toBe(reputationSkill.fallback)
  })

  it("pins effort LOW for latency, and leaves the nightly skill's own effort untouched", () => {
    expect(starterSkill.effort).toBe("low")
    expect(reputationSkill.effort).toBeUndefined() // still takes the fleet dial
  })

  it("is not a deep-pass skill (the starter must not run Opus)", () => {
    expect(starterSkill.deep).toBeFalsy()
  })
})

describe("starterReadiness", () => {
  it("is READY on an own review-theme rule output, the one buildDossier can produce at t=0", () => {
    const r = starterReadiness(read({ ruleOutputTypes: ["review.theme"], ownReviewThemeCount: 3, hasOwnListing: true }))
    expect(r).toEqual({ ready: true, reason: null, citableRefs: ["review.theme"] })
  })

  it("collects every citable ref, not just the first", () => {
    const r = starterReadiness(read({ ruleOutputTypes: ["review.theme", "hours.own_slow_window", "review.theme"] }))
    expect(r.citableRefs).toEqual(["review.theme", "review.theme"])
  })

  it("is NOT ready on an empty dossier, and says why", () => {
    const r = starterReadiness(read())
    expect(r.ready).toBe(false)
    expect(r.reason).toBe("no_signal_yet")
    expect(r.citableRefs).toEqual([])
  })

  it("is NOT ready when signals exist but none are the family the skill grounds on", () => {
    // The producer's own parse gate would drop every play here, so the call is not worth making.
    const r = starterReadiness(read({ ruleOutputTypes: ["hours.own_slow_window", "traffic.baseline"], hasOwnListing: true }))
    expect(r.ready).toBe(false)
    expect(r.reason).toBe("no_review_signal")
  })

  it("does not treat review themes as grounding on their own — a ref is what the filter checks", () => {
    // themes are prompt CONTEXT; only the rule outputs are citable, and run.ts drops anything else.
    const r = starterReadiness(read({ ownReviewThemeCount: 5, hasOwnListing: true }))
    expect(r.ready).toBe(false)
  })
})

describe("starterNotReadyMessage", () => {
  it("gives a plain reason for each code, with no filler and no promise", () => {
    for (const reason of ["no_signal_yet", "no_review_signal"] as const) {
      const message = starterNotReadyMessage(reason)
      expect(message.length).toBeGreaterThan(10)
      expect(message).not.toMatch(/—/) // no em dashes in customer copy
      expect(message).not.toMatch(/still learning|check back|soon/i)
    }
  })
})

describe("pickStarterPlay", () => {
  it("returns null when the producer grounded nothing", () => {
    expect(pickStarterPlay([])).toBeNull()
  })

  it("prefers a play with real steps over an observation — the target is a USABLE insight", () => {
    const observation = play({ title: "obs", confidence: "high" })
    const actionable = play({ title: "act", confidence: "directional", recipe: [STEP] })
    expect(pickStarterPlay([observation, actionable])?.title).toBe("act")
  })

  it("then prefers higher confidence", () => {
    const medium = play({ title: "medium", confidence: "medium", recipe: [STEP] })
    const high = play({ title: "high", confidence: "high", recipe: [STEP] })
    expect(pickStarterPlay([medium, high])?.title).toBe("high")
  })

  it("then prefers more grounded refs", () => {
    const one = play({ title: "one", recipe: [STEP], evidenceRefs: ["review.theme"] })
    const two = play({ title: "two", recipe: [STEP], evidenceRefs: ["review.theme", "review.theme:mentions"] })
    expect(pickStarterPlay([one, two])?.title).toBe("two")
  })

  it("is stable: equal plays keep producer order, so a rerun cannot reshuffle what was read", () => {
    const a = play({ title: "a" })
    const b = play({ title: "b" })
    expect(pickStarterPlay([a, b])?.title).toBe("a")
    expect(pickStarterPlay([a, b])?.title).toBe("a")
  })
})

describe("parseStoredStarter", () => {
  const stored = {
    version: "1.0",
    generatedAt: "2026-08-13T10:00:00.000Z",
    skillId: "reputation",
    knowledgeVersion: "reputation@v2",
    usedFallback: false,
    play: play(),
  }

  it("round-trips a real stored row", () => {
    const parsed = parseStoredStarter(stored)
    expect(parsed?.play.title).toBe("t")
    expect(parsed?.usedFallback).toBe(false)
  })

  it("carries the fallback flag through, so a degraded starter stays visible", () => {
    const parsed = parseStoredStarter({ ...stored, usedFallback: true, fallbackReason: "timeout" })
    expect(parsed?.usedFallback).toBe(true)
    expect(parsed?.fallbackReason).toBe("timeout")
  })

  it("rejects anything that is not a grounded play (an ungrounded play is never rendered)", () => {
    expect(parseStoredStarter(null)).toBeNull()
    expect(parseStoredStarter({})).toBeNull()
    expect(parseStoredStarter({ ...stored, play: { ...play(), evidenceRefs: [] } })).toBeNull()
    expect(parseStoredStarter({ ...stored, play: { title: "t" } })).toBeNull()
  })
})
