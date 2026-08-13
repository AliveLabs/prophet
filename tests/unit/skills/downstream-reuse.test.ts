// Differential builds Phase 2 — downstream reuse (harm review + synthesis + write carried forward).
// The dangerous failure modes: skipping downstream when a producer actually regenerated (the pool
// changed), skipping when a NON-producer input changed (a play dismissed last night must not
// resurface), reusing from a brief that has nothing to reuse (pre-Phase-2 / fallback brief), and
// the inverse — a reused day that is invisible in telemetry. Full-build days pass no `previous`
// (env DIFFERENTIAL_BUILDS=0 · ?fullBuild=1 · Sunday-local — all gated in loadPreviousBuild), so
// "no previous ⇒ no skip" is the kill-switch guarantee tested here.

import { describe, it, expect } from "vitest"
import {
  decideDownstreamReuse,
  downstreamFingerprint,
  extractPreviousBuild,
  type PreviousBuild,
} from "@/lib/skills/differential"
import { runBrief, collectDownstreamInputs } from "@/lib/skills/pipeline"
import { arenaWeekDossier } from "@/tests/fixtures/dossiers/arena-week"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"
import type { Transport } from "@/lib/ai/provider"

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────

/** A grounded play (cites a real arena-week ref) with a per-skill title so fusion sees no near-dups. */
const groundedPlay = (title: string): Omit<EnrichedRecommendation, "skillId" | "knowledgeVersion"> => ({
  title,
  rationale: "A high-signal event lands this week within your blocks; get an offer in front of ticketholders.",
  kind: "capitalize",
  ownerRole: "marketing",
  confidence: "high",
  recipe: [
    {
      channel: "Instagram",
      platforms: ["Instagram"],
      audience: "ticketholders near the venue",
      window: { note: "early evening, pre-show" },
      copy: "Right by the show tonight. Come in before doors.",
    },
  ],
  evidenceRefs: ["events.new_high_signal_event"],
})

/** A minimal real producer: stable selectInput slice (same hash every run over the same dossier),
 *  parse that accepts the transport's array, deterministic empty fallback. */
const mkSkill = (id: string): ProducerSkill => ({
  id,
  displayName: id,
  ownerRole: "marketing",
  kind: "capitalize",
  category: "marketing",
  tier: "reasoning",
  temperature: 0.4,
  knowledgeVersion: "v1",
  knowledge: "test knowledge",
  buildPrompt: () => ({ system: `You are producer ${id}.`, prompt: "{}" }),
  parse: (raw) => (Array.isArray(raw) && raw.length > 0 ? (raw as EnrichedRecommendation[]) : null),
  fallback: () => [],
  selectInput: (d) => ({ profileName: d.profile.name, marker: id }),
})

const SKILLS: ProducerSkill[] = [mkSkill("ds-alpha"), mkSkill("ds-beta")]

/** Transport for a GENERATED day: producers get their play, the Chief of Staff gets a selection,
 *  the brand-fit reviewer gets clean verdicts, anything else (fusion) gets junk (fail-soft keep). */
const generatedTransport =
  (counters: { producers: number; synthesis: number; review: number }): Transport =>
  async (req) => {
    const sys = req.system ?? ""
    if (sys.includes("Chief of Staff")) {
      counters.synthesis++
      return { headline: "Own the [[arena]] weekend", deck: "Two grounded moves this week around the arena calendar.", order: [0, 1] }
    }
    if (sys.includes("brand-fit reviewer")) {
      counters.review++
      return [] // no flags → everything kept at severity 0
    }
    if (sys.includes("You are producer ds-alpha")) {
      counters.producers++
      return [groundedPlay("Run a pre-show seating push")]
    }
    if (sys.includes("You are producer ds-beta")) {
      counters.producers++
      return [groundedPlay("Stage a post-show dessert window")]
    }
    return [] // fusion/write etc. — validators reject junk and keep originals (fail-soft)
  }

const explodingTransport: Transport = async (req) => {
  throw new Error(`model was called on a fully-reused day (label=${req.label ?? "?"}, system=${(req.system ?? "").slice(0, 40)})`)
}

async function buildDayOne() {
  const counters = { producers: 0, synthesis: 0, review: 0 }
  const { brief } = await runBrief(arenaWeekDossier, { skills: SKILLS, transport: generatedTransport(counters) })
  expect(counters.producers).toBe(2) // both producers really ran (no fallback → reusable tomorrow)
  expect(brief.skillHealth?.every((h) => !h.usedFallback && h.status === "ok" && h.inputHash)).toBe(true)
  expect(brief.downstreamFingerprint).toBeTruthy()
  return brief
}

/** Yesterday's brief as tomorrow's PreviousBuild (same-day key is within the age bound). */
function asPrevious(brief: Brief): PreviousBuild {
  const prev = extractPreviousBuild(brief, brief.dateKey)
  expect(prev).toBeDefined()
  return prev!
}

// ── the skip decision (pure) ──────────────────────────────────────────────────────────────────

describe("decideDownstreamReuse", () => {
  const results = [
    { skillId: "a", reused: true },
    { skillId: "b", reused: true },
  ]
  const previous: PreviousBuild = {
    hashes: { a: "h1", b: "h2" },
    outputs: { a: [], b: [] },
    downstream: { headline: "h", deck: "d", plays: [], fingerprint: "fp" },
  }

  it("skips ONLY when every producer reused, downstream state exists, and the fingerprint matches", () => {
    expect(decideDownstreamReuse({ skillResults: results, previous, todayFingerprint: "fp" })).toEqual({ reuse: true })
  })
  it("one regenerated producer → no skip (the pool may differ)", () => {
    const d = decideDownstreamReuse({
      skillResults: [{ skillId: "a", reused: true }, { skillId: "b" }],
      previous,
      todayFingerprint: "fp",
    })
    expect(d.reuse).toBe(false)
    expect((d as { reason: string }).reason).toContain("b")
  })
  it("no previous build (full-build day / kill switches pass none) → no skip", () => {
    expect(decideDownstreamReuse({ skillResults: results, previous: undefined, todayFingerprint: "fp" }).reuse).toBe(false)
  })
  it("previous brief without downstream state (pre-Phase-2) → no skip — absence is not innocence", () => {
    const noDs: PreviousBuild = { hashes: previous.hashes, outputs: previous.outputs }
    expect(decideDownstreamReuse({ skillResults: results, previous: noDs, todayFingerprint: "fp" }).reuse).toBe(false)
  })
  it("fingerprint mismatch or unavailable → no skip", () => {
    expect(decideDownstreamReuse({ skillResults: results, previous, todayFingerprint: "OTHER" }).reuse).toBe(false)
    expect(decideDownstreamReuse({ skillResults: results, previous, todayFingerprint: undefined }).reuse).toBe(false)
  })
  it("zero producers → no skip", () => {
    expect(decideDownstreamReuse({ skillResults: [], previous, todayFingerprint: "fp" }).reuse).toBe(false)
  })
})

// ── extraction gates ──────────────────────────────────────────────────────────────────────────

describe("extractPreviousBuild downstream state", () => {
  const play = { title: "carried" } as unknown as EnrichedRecommendation
  const briefWithDs = (over: Partial<Brief> = {}): Brief =>
    ({
      locationId: "l",
      dateKey: "2026-08-11",
      headline: "Real headline",
      deck: "Real deck",
      plays: [play],
      asOf: "x",
      skillHealth: [{ skillId: "rep", status: "ok", usedFallback: false, inputHash: "abc" }],
      skillOutputs: { rep: [play] },
      downstreamFingerprint: "fp-1",
      ...over,
    }) as Brief

  it("carries downstream state when the brief has headline/deck/plays + fingerprint", () => {
    const prev = extractPreviousBuild(briefWithDs(), "2026-08-12")
    expect(prev?.downstream).toEqual({ headline: "Real headline", deck: "Real deck", plays: [play], fingerprint: "fp-1" })
  })
  it("a fallback-served brief never seeds downstream reuse", () => {
    expect(extractPreviousBuild(briefWithDs({ fallback: true }), "2026-08-12")?.downstream).toBeUndefined()
  })
  it("a pre-Phase-2 brief (no fingerprint) yields no downstream state — but producer reuse still works", () => {
    const prev = extractPreviousBuild(briefWithDs({ downstreamFingerprint: undefined }), "2026-08-12")
    expect(prev?.downstream).toBeUndefined()
    expect(prev?.hashes).toEqual({ rep: "abc" })
  })
})

// ── fingerprint sensitivity ───────────────────────────────────────────────────────────────────

describe("downstream fingerprint", () => {
  const p = { ...groundedPlay("Alpha play"), skillId: "ds-alpha", knowledgeVersion: "v1" } as EnrichedRecommendation
  const results = [{ skillId: "ds-alpha", inputHash: "h1", plays: [p] }]

  it("is stable for identical inputs, regardless of suppression-set iteration order", () => {
    const a = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, results, { suppressedKeys: new Set(["x", "y"]) }))
    const b = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, results, { suppressedKeys: new Set(["y", "x"]) }))
    expect(a).toBe(b)
  })
  it("changes when a play is dismissed (suppression set), so a dismissal always forces a real downstream run", () => {
    const base = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, results, {}))
    const dismissed = downstreamFingerprint(
      collectDownstreamInputs(arenaWeekDossier, results, { suppressedKeys: new Set(["ds-alpha:alpha-play"]) }),
    )
    expect(dismissed).not.toBe(base)
  })
  it("changes when a click-feedback multiplier moves (any severity band) or tolerance/priors/maxPlays move", () => {
    const base = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, results, {}))
    const boosted = downstreamFingerprint(
      collectDownstreamInputs(arenaWeekDossier, results, { playTypeMultipliers: { multiplierFor: (k) => (k.endsWith("|wild") ? 1.3 : 1) } }),
    )
    expect(boosted).not.toBe(base)
    const capped = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, results, { maxPlays: 3 }))
    expect(capped).not.toBe(base)
    const tolerant = downstreamFingerprint(
      collectDownstreamInputs({ ...arenaWeekDossier, profile: { ...arenaWeekDossier.profile, brandTolerance: 90 } }, results, {}),
    )
    expect(tolerant).not.toBe(base)
  })
  it("changes when the evergreen pool changes", () => {
    const base = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, results, {}))
    const withEvergreen = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, results, { evergreen: [p] }))
    expect(withEvergreen).not.toBe(base)
  })
  it("changes when a producer's input hash changes", () => {
    const base = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, results, {}))
    const moved = downstreamFingerprint(
      collectDownstreamInputs(arenaWeekDossier, [{ ...results[0], inputHash: "h2" }], {}),
    )
    expect(moved).not.toBe(base)
  })
  it("changes when the SKILL SET changes — removing a skill from the registry forces a full downstream rebuild, never a false reuse", () => {
    // The 2026-08-12 skill retirement relies on this: skillHashes is a KEYED record, so a brief
    // fingerprinted under yesterday's roster can never byte-match a fingerprint computed over a
    // smaller (or larger) roster, even when every surviving skill's hash is identical.
    const p2 = { ...groundedPlay("Beta play"), skillId: "ds-beta", knowledgeVersion: "v1" } as EnrichedRecommendation
    const twoSkills = [...results, { skillId: "ds-beta", inputHash: "h9", plays: [p2] }]
    const withBoth = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, twoSkills, {}))
    const withOne = downstreamFingerprint(collectDownstreamInputs(arenaWeekDossier, results, {}))
    expect(withOne).not.toBe(withBoth)
  })
})

// ── the pipeline end to end ───────────────────────────────────────────────────────────────────

describe("runBrief downstream reuse (Phase 2)", () => {
  it("fully-reused day: zero model calls, carried narrative + plays, VISIBLE via providerStats.downstreamReused", async () => {
    const day1 = await buildDayOne()
    const { brief: day2, dropped } = await runBrief(arenaWeekDossier, {
      skills: SKILLS,
      previous: asPrevious(day1),
      transport: explodingTransport, // ANY model call on the reused day fails the test
    })
    expect(day2.providerStats?.downstreamReused).toBe(true)
    expect(day2.headline).toBe(day1.headline)
    expect(day2.deck).toBe(day1.deck)
    expect(day2.plays).toEqual(day1.plays)
    expect(day2.skillHealth?.every((h) => h.reused)).toBe(true)
    expect(day2.downstreamFingerprint).toBe(day1.downstreamFingerprint)
    expect(dropped).toEqual([])
    // evalCheck posture: re-run TODAY (deterministic, no model call), never carried forward blindly.
    expect(day2.evalCheck).toBeDefined()
    // a generated day never carries the flag
    expect(day1.providerStats?.downstreamReused).toBeUndefined()
  })

  it("partial reuse (one producer regenerated) keeps the full downstream run", async () => {
    const day1 = await buildDayOne()
    const prev = asPrevious(day1)
    const tampered: PreviousBuild = { ...prev, hashes: { ...prev.hashes, "ds-beta": "input-actually-changed" } }
    const counters = { producers: 0, synthesis: 0, review: 0 }
    const { brief: day2 } = await runBrief(arenaWeekDossier, {
      skills: SKILLS,
      previous: tampered,
      transport: generatedTransport(counters),
    })
    expect(counters.producers).toBe(1) // only ds-beta regenerated
    expect(counters.synthesis).toBe(1) // downstream really ran
    expect(counters.review).toBe(1)
    expect(day2.providerStats?.downstreamReused).toBeUndefined()
  })

  it("prior brief without downstream outputs → no skip even when every producer reused", async () => {
    const day1 = await buildDayOne()
    const prev = asPrevious(day1)
    const noDownstream: PreviousBuild = { hashes: prev.hashes, outputs: prev.outputs }
    const counters = { producers: 0, synthesis: 0, review: 0 }
    const { brief: day2 } = await runBrief(arenaWeekDossier, {
      skills: SKILLS,
      previous: noDownstream,
      transport: generatedTransport(counters),
    })
    expect(counters.producers).toBe(0) // producers still reused…
    expect(counters.synthesis).toBe(1) // …but downstream ran (nothing to reuse)
    expect(day2.providerStats?.downstreamReused).toBeUndefined()
  })

  it("full-build day (no `previous` — env off / ?fullBuild / Sunday-local) is completely unaffected", async () => {
    const day1 = await buildDayOne()
    void day1
    const counters = { producers: 0, synthesis: 0, review: 0 }
    const { brief } = await runBrief(arenaWeekDossier, { skills: SKILLS, transport: generatedTransport(counters) })
    expect(counters.producers).toBe(2)
    expect(counters.synthesis).toBe(1)
    expect(brief.providerStats?.downstreamReused).toBeUndefined()
  })

  it("a dismissal since yesterday (suppression change) forces the full downstream run", async () => {
    const day1 = await buildDayOne()
    const counters = { producers: 0, synthesis: 0, review: 0 }
    const { brief: day2 } = await runBrief(arenaWeekDossier, {
      skills: SKILLS,
      previous: asPrevious(day1),
      suppressedKeys: new Set(["ds-alpha:run-a-pre-show-seating-push"]),
      transport: generatedTransport(counters),
    })
    expect(counters.synthesis).toBe(1)
    expect(day2.providerStats?.downstreamReused).toBeUndefined()
  })
})
