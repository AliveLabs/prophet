import { describe, it, expect } from "vitest"
import {
  evaluateBrief,
  extractNumbers,
  checkNoExecutableFields,
  checkEvidenceRefsResolve,
  checkNumbersTraceToEvidence,
  type RefIndex,
} from "@/lib/eval/checks"
import { lintVoice } from "@/lib/eval/voice-rules"
import { overallScore, passesGate, judgeBrief, type JudgeVerdict } from "@/lib/eval/judge"
import type { EnrichedRecommendation } from "@/lib/skills/types"

// A dossier index: what the rules actually proved for this location/day.
const INDEX: RefIndex = {
  allowedRefs: new Set(["events.new_high_signal_event", "content.conversion_feature_gap"]),
  evidenceNumbers: new Set([35, 5, 7]),
}

// A clean, fully-grounded play (arena-week marketing capitalize).
const VALID: EnrichedRecommendation = {
  title: "Run a pre-show prix-fixe Friday",
  rationale:
    "A high-signal event lands half a mile away Friday and you have an open dinner window before it.",
  skillId: "marketing",
  ownerRole: "marketing",
  kind: "capitalize",
  recipe: [
    {
      channel: "Meta geo-ads",
      platforms: ["Instagram", "Meta Ads"],
      audience: "ticketholders within 1 mi, before the show",
      window: { note: "Fri 5 to 7p, pre-show" },
      offer: "pre-show prix-fixe $35",
      copy: "Pre-show seating from 5. Walk to the show after.",
    },
  ],
  confidence: "high",
  evidenceRefs: ["events.new_high_signal_event"],
  knowledgeVersion: "marketing@v1",
}

// A deliberately broken play exercising every check.
const INVALID = {
  title: "Raise prices — you are underpriced", // em dash -> voice
  rationale: "Competitors charge more.",
  skillId: "pricing",
  ownerRole: "boss", // bad enum
  kind: "capitalize",
  recipe: [
    {
      channel: "in-store",
      platforms: [],
      audience: "all guests",
      window: { note: "this weekend" },
      offer: "spend $99 get a free entree", // 99 ungrounded
      postNow: true, // executable field
    },
  ],
  confidence: "very-high", // bad enum
  evidenceRefs: ["seo_made_up_ref"], // unresolved
  knowledgeVersion: "pricing@v1",
} as unknown as EnrichedRecommendation

describe("extractNumbers", () => {
  it("parses currency, percentages, and thousands", () => {
    expect(extractNumbers("spend $35 for 7 courses, up 43%")).toEqual([35, 7, 43])
    expect(extractNumbers("about 30,000 people")).toEqual([30000])
    expect(extractNumbers(null)).toEqual([])
  })
})

describe("lintVoice", () => {
  it("flags em dashes and chef lingo", () => {
    expect(lintVoice("clean copy, no issues").length).toBe(0)
    expect(lintVoice("get your mise en place ready").some((v) => v.kind === "chef_lingo")).toBe(true)
    expect(lintVoice("staff up — then relax").some((v) => v.kind === "em_dash")).toBe(true)
  })
})

describe("deterministic checks", () => {
  it("passes a clean, fully-grounded brief", () => {
    const res = evaluateBrief({ plays: [VALID] }, INDEX)
    expect(res.ok).toBe(true)
    expect(res.violations).toEqual([])
  })

  it("catches every violation in a broken play", () => {
    const res = evaluateBrief({ plays: [INVALID] }, INDEX)
    expect(res.ok).toBe(false)
    const codes = new Set(res.violations.map((v) => v.code))
    expect(codes.has("bad_owner_role")).toBe(true)
    expect(codes.has("bad_confidence")).toBe(true)
    expect(codes.has("executable_field")).toBe(true)
    expect(codes.has("unresolved_evidence_ref")).toBe(true)
    expect(codes.has("voice_em_dash")).toBe(true)
  })

  it("rejects a play with no evidence refs", () => {
    const noRefs = { ...VALID, evidenceRefs: [] }
    expect(checkEvidenceRefsResolve(noRefs, 0, INDEX).some((v) => v.code === "no_evidence_refs")).toBe(true)
  })

  it("blocks fabricated reach numbers (anti-fabrication)", () => {
    const fab = { ...VALID, leverage: { label: "high" as const, reach: "30,000 attendees", basisInternal: "x" } }
    expect(checkNumbersTraceToEvidence(fab, 0, INDEX).some((v) => v.code === "ungrounded_reach")).toBe(true)
  })

  it("detects nested executable fields", () => {
    expect(checkNoExecutableFields(INVALID, 0).some((v) => v.code === "executable_field")).toBe(true)
  })
})

describe("judge gate", () => {
  it("averages the four axes", () => {
    expect(overallScore({ specificity: 4, nonObviousness: 4, actionableSmallBudget: 4, groundingFaithfulness: 4 })).toBe(4)
  })

  it("passes only when it clears the bar AND beats the baseline with no tone-deaf plays", () => {
    const strong: JudgeVerdict = {
      scores: { specificity: 4.5, nonObviousness: 4, actionableSmallBudget: 4, groundingFaithfulness: 4.5 },
      toneDeaf: [],
      notes: "",
    }
    const weakBaseline: JudgeVerdict = {
      scores: { specificity: 2, nonObviousness: 1.5, actionableSmallBudget: 2, groundingFaithfulness: 3 },
      toneDeaf: [],
      notes: "",
    }
    expect(passesGate({ candidate: strong, baseline: weakBaseline }).pass).toBe(true)

    const toneDeaf: JudgeVerdict = { ...strong, toneDeaf: ["raise prices during a slump"] }
    expect(passesGate({ candidate: toneDeaf, baseline: weakBaseline }).pass).toBe(false)
  })
})

describe("judgeBrief parsing", () => {
  it("parses a JSON verdict from a (mocked) model response", async () => {
    const mock = async () =>
      'noise before {"scores":{"specificity":4,"nonObviousness":3,"actionableSmallBudget":4,"groundingFaithfulness":5},"toneDeaf":[],"notes":"solid"} trailing'
    const verdict = await judgeBrief(
      { locationId: "l1", dateKey: "2026-06-26", headline: "h", deck: "d", plays: [VALID], asOf: "6:02a" },
      "dossier summary",
      mock,
    )
    expect(verdict.scores.groundingFaithfulness).toBe(5)
    expect(verdict.notes).toBe("solid")
  })
})
