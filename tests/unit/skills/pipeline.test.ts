import { describe, it, expect } from "vitest"
import { runProducerSkills } from "@/lib/skills/run"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { synthesize } from "@/lib/skills/synthesis"
import { voicePass, scrubBrief, isVoiceClean } from "@/lib/skills/voice"
import { evaluateBrief } from "@/lib/eval/checks"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { arenaWeekDossier } from "@/tests/fixtures/dossiers/arena-week"
import type { Transport } from "@/lib/ai/provider"
import type { Brief } from "@/lib/skills/types"

const index = buildRefIndex(arenaWeekDossier)

// A grounded, number-free play (valid for any producer — cites a real dossier ref).
const goodPlay = {
  title: "Run a pre-show seating push",
  rationale: "A high-signal event lands this week within your blocks; get an offer in front of ticketholders.",
  kind: "capitalize",
  ownerRole: "marketing",
  confidence: "high",
  recipe: [
    {
      channel: "Instagram + Google Business",
      platforms: ["Instagram"],
      audience: "ticketholders near the venue before the show",
      window: { note: "early evening, pre-show" },
      copy: "Right by the show tonight. Come in before doors.",
    },
  ],
  evidenceRefs: ["events.new_high_signal_event"],
}

// One transport drives the whole pipeline; branch on the Chief-of-Staff system prompt.
const smartTransport: Transport = async (req) => {
  if ((req.system ?? "").includes("Chief of Staff")) {
    return { headline: "Your rivals still own the weekend", deck: "A big event lands Friday and your value gap is open. Two moves this week.", order: [0, 1] }
  }
  return [goodPlay]
}

async function runPipeline(transport?: Transport): Promise<Brief> {
  const results = await runProducerSkills(PRODUCER_SKILLS, arenaWeekDossier, transport ? { transport } : {})
  const brief = await synthesize(arenaWeekDossier, results, transport ? { transport } : {})
  return voicePass(brief)
}

describe("full engine pipeline (producers -> synthesis -> voice)", () => {
  it("happy path: produces a 1-3 play brief that is grounded, eval-clean and voice-clean", async () => {
    const brief = await runPipeline(smartTransport)
    expect(brief.plays.length).toBeGreaterThanOrEqual(1)
    expect(brief.plays.length).toBeLessThanOrEqual(3)
    expect(brief.headline.length).toBeGreaterThan(0)
    // every play is grounded in the dossier
    for (const p of brief.plays) {
      expect(p.evidenceRefs.every((r) => index.allowedRefs.has(r))).toBe(true)
    }
    expect(evaluateBrief({ plays: brief.plays }, index).ok).toBe(true)
    expect(isVoiceClean(brief)).toBe(true)
  })

  it("full-fallback resilience: even if every model call fails, the brief is real and grounded", async () => {
    const throwing: Transport = async () => {
      throw new Error("model outage")
    }
    const brief = await runPipeline(throwing)
    expect(brief.plays.length).toBeGreaterThan(0)
    for (const p of brief.plays) {
      expect(p.evidenceRefs.every((r) => index.allowedRefs.has(r))).toBe(true)
    }
    expect(evaluateBrief({ plays: brief.plays }, index).ok).toBe(true)
  })

  it("voice pass scrubs em dashes and chef jargon to guarantee compliance", () => {
    const dirty: Brief = {
      locationId: "l",
      dateKey: "d",
      headline: "Get your mise en place ready — service is coming",
      deck: "Two-top turnover is up — lean in.",
      plays: [],
      asOf: "x",
    }
    const clean = scrubBrief(dirty)
    expect(isVoiceClean(clean)).toBe(true)
    expect(clean.headline.includes("—")).toBe(false)
    expect(/mise en place/i.test(clean.headline)).toBe(false)
  })

  it("quiet week: no candidate plays yields an honest quiet brief, not a fabricated one", async () => {
    const emptyResults = await runProducerSkills([], arenaWeekDossier, {})
    const brief = await synthesize(arenaWeekDossier, emptyResults, {})
    expect(brief.plays.length).toBe(0)
    expect(brief.headline.toLowerCase()).toContain("quiet")
  })

  it("salvages the model headline+deck even when the order array is unusable", async () => {
    // Model framing is good but the order is malformed/empty — must NOT drop to the generic deck.
    const badOrder: Transport = async (req) => {
      if ((req.system ?? "").includes("Chief of Staff")) {
        return { headline: "Own the weekend rush", deck: "A custom, specific deck the model wrote.", order: [] }
      }
      return [goodPlay]
    }
    const brief = await runPipeline(badOrder)
    expect(brief.headline).toContain("Own the weekend rush")
    expect(brief.deck).toContain("custom, specific deck")
    expect(brief.plays.length).toBeGreaterThan(0) // deterministic ordering fills in
  })

  it("dedupes a repeated model order index so the same play never appears twice", async () => {
    // A model at temperature can name the same index twice; the brief must list it once.
    const dupOrder: Transport = async (req) => {
      if ((req.system ?? "").includes("Chief of Staff")) {
        return { headline: "Repeated picks collapse to one", deck: "The model named a play twice; the brief lists it once.", order: [0, 0, 1] }
      }
      return [goodPlay]
    }
    const brief = await runPipeline(dupOrder)
    expect(brief.plays.length).toBeGreaterThanOrEqual(1)
    expect(new Set(brief.plays).size).toBe(brief.plays.length) // no duplicate play references
  })

  it("provider down: fallback deck is SPECIFIC (grounded themes), never the empty/generic string", async () => {
    const throwing: Transport = async () => {
      throw new Error("529 overloaded")
    }
    const brief = await runPipeline(throwing)
    expect(brief.deck.length).toBeGreaterThan(0)
    expect(brief.deck.toLowerCase()).toContain("ranked by impact") // deterministicDeck signature
    expect(brief.plays.length).toBeGreaterThan(0)
  })

  it("carries the dossier's per-signal coverage (stale signal stays flagged, not dropped)", async () => {
    const withCoverage = {
      ...arenaWeekDossier,
      coverage: [
        { label: "Social", present: true, stale: true, asOf: "2026-03-06", detail: "3 profiles" },
        { label: "Weather", present: false, detail: "no forecast", asOf: null },
      ],
    }
    const results = await runProducerSkills(PRODUCER_SKILLS, withCoverage, { transport: smartTransport })
    const brief = await synthesize(withCoverage, results, { transport: smartTransport })
    const social = brief.coverage?.find((c) => c.label === "Social")
    expect(social?.present).toBe(true)
    expect(social?.stale).toBe(true)
    expect(social?.asOf).toBe("2026-03-06")
  })
})
