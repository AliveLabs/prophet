// ALT-354: the response draft generator, run against a stubbed transport (no
// live calls, no spend; same pattern as scoring.test.ts). Pins: the request
// shape (reasoning tier, temp 0.4, NO thinking), the posture routing (comp
// language only for comp, measured owner-attention, brief doubtful), and the
// output gate (deny-list, length ceiling, em-dash sanitize, null fallback:
// a bad draft is discarded, never shown).

import { describe, it, expect } from "vitest"
import { generateReviewResponseDraft, DRAFT_MAX_CHARS } from "@/lib/reviews/draft"
import type { GenerateRequest, Transport } from "@/lib/ai/provider"
import type { LocationReviewRow, MakeGoodRecommendation } from "@/lib/reviews/types"

/** Minimal row factory: only the fields the draft path reads matter here. */
function rowWith(partial: Partial<LocationReviewRow> = {}): LocationReviewRow {
  return {
    id: "row-1",
    location_id: "loc-1",
    source: "google_places",
    source_review_id: "reviews/abc",
    author_name: "Pat",
    author_key: "name:pat",
    rating: 1,
    review_text: "Waited forever and the order was wrong.",
    published_at: "2026-07-01T12:00:00Z",
    relative_published: "2 weeks ago",
    google_maps_uri: null,
    first_seen_at: "2026-07-01T12:00:00Z",
    last_seen_at: "2026-07-15T12:00:00Z",
    authenticity_score: 80,
    authenticity_confidence: "high",
    authenticity_rationale: "Reads like a real visit.",
    severity_score: 55,
    severity_rationale: "A serious but ordinary complaint.",
    red_flags: [],
    scored_at: "2026-07-15T12:00:00Z",
    score_version: "ri-v1",
    triage_status: "open",
    triage_updated_at: null,
    operator_verdict: null,
    operator_verdict_at: null,
    draft_text: null,
    draft_generated_at: null,
    ...partial,
  }
}

function recWith(partial: Partial<MakeGoodRecommendation> = {}): MakeGoodRecommendation {
  return {
    tier: "respond",
    rationale: "A sincere, specific reply is the right move here; no offer needed.",
    ownerAttention: false,
    ...partial,
  }
}

/** Stub transport that captures the request and returns a fixed raw payload. */
function stub(payload: unknown): { transport: Transport; last: () => GenerateRequest } {
  let captured: GenerateRequest | null = null
  return {
    transport: async (req) => {
      captured = req
      return payload
    },
    last: () => {
      if (!captured) throw new Error("transport never called")
      return captured
    },
  }
}

const draftInput = (over: Partial<Parameters<typeof generateReviewResponseDraft>[0]> = {}) => ({
  row: rowWith(),
  recommendation: recWith(),
  voiceTone: null as string | null,
  locationName: "Bush's Chicken",
  ...over,
})

describe("generateReviewResponseDraft", () => {
  it("happy path: reasoning tier, temp 0.4, NO thinking; review + location in the payload", async () => {
    const { transport, last } = stub({ draft: "Pat, I'm sorry about the wait and the wrong order. That's on us." })
    const draft = await generateReviewResponseDraft({ ...draftInput(), transport })
    expect(draft).toBe("Pat, I'm sorry about the wait and the wrong order. That's on us.")
    const req = last()
    expect(req.tier).toBe("reasoning")
    expect(req.temperature).toBe(0.4)
    expect(req.thinking).toBeUndefined()
    expect(req.system).toContain("Bush's Chicken")
    expect(req.prompt).toContain("Waited forever and the order was wrong.")
  })

  it("voiceTone lands in the system prompt when provided, and only then", async () => {
    const withTone = stub({ draft: "Thanks for telling us." })
    await generateReviewResponseDraft({ ...draftInput({ voiceTone: "playful and homey" }), transport: withTone.transport })
    expect(withTone.last().system).toContain("playful and homey")

    const without = stub({ draft: "Thanks for telling us." })
    await generateReviewResponseDraft({ ...draftInput(), transport: without.transport })
    expect(without.last().system).not.toContain("preferred voice")
  })

  it('posture routing: "on us" comp language is issued ONLY for tier comp', async () => {
    const comp = stub({ draft: "ok" })
    await generateReviewResponseDraft({ ...draftInput({ recommendation: recWith({ tier: "comp" }) }), transport: comp.transport })
    expect(comp.last().system).toContain("the next one on us")

    for (const tier of ["respond", "discount"] as const) {
      const s = stub({ draft: "ok" })
      await generateReviewResponseDraft({ ...draftInput({ recommendation: recWith({ tier }) }), transport: s.transport })
      expect(s.last().system).not.toContain("on us")
    }
  })

  it("discount guidance stays unpriced and softer; respond forbids any offer", async () => {
    const discount = stub({ draft: "ok" })
    await generateReviewResponseDraft({ ...draftInput({ recommendation: recWith({ tier: "discount" }) }), transport: discount.transport })
    expect(discount.last().system).toContain("Never name a dollar amount")

    const respond = stub({ draft: "ok" })
    await generateReviewResponseDraft({ ...draftInput(), transport: respond.transport })
    expect(respond.last().system).toContain("Do NOT offer compensation")
  })

  it("ownerAttention overrides the tier: measured, no admission of fault, direct contact", async () => {
    const { transport, last } = stub({ draft: "ok" })
    await generateReviewResponseDraft({
      ...draftInput({ recommendation: recWith({ tier: "comp", ownerAttention: true }) }),
      transport,
    })
    const system = last().system ?? ""
    expect(system).toContain("no admission of fault")
    expect(system).toContain("contact the owner directly")
    expect(system).not.toContain("the next one on us")
  })

  it("doubtful genuineness (suspect score / operator verdict) pulls the brief non-escalating posture", async () => {
    const suspect = stub({ draft: "ok" })
    await generateReviewResponseDraft({
      ...draftInput({ row: rowWith({ authenticity_score: 10 }), recommendation: recWith({ tier: "comp" }) }),
      transport: suspect.transport,
    })
    expect(suspect.last().system).toContain("may not reflect a real visit")
    expect(suspect.last().system).not.toContain("the next one on us")

    const verdict = stub({ draft: "ok" })
    await generateReviewResponseDraft({
      ...draftInput({ row: rowWith({ operator_verdict: "not_genuine" }) }),
      transport: verdict.transport,
    })
    expect(verdict.last().system).toContain("may not reflect a real visit")
  })

  it("deny-list hit voids the draft (case-insensitive, every phrase)", async () => {
    for (const phrase of ["remove this review", "FLAG THIS REVIEW", "Take This Down", "report this review"]) {
      const { transport } = stub({ draft: `We will ${phrase} right away, promise.` })
      const draft = await generateReviewResponseDraft({ ...draftInput(), transport })
      expect(draft).toBeNull()
    }
  })

  it("length gate: over the ceiling -> null; at the ceiling -> kept", async () => {
    const over = stub({ draft: "x".repeat(DRAFT_MAX_CHARS + 1) })
    expect(await generateReviewResponseDraft({ ...draftInput(), transport: over.transport })).toBeNull()

    const at = stub({ draft: "x".repeat(DRAFT_MAX_CHARS) })
    expect(await generateReviewResponseDraft({ ...draftInput(), transport: at.transport })).toHaveLength(DRAFT_MAX_CHARS)
  })

  it("em dashes are sanitized to commas, never shipped", async () => {
    const { transport } = stub({ draft: "I'm sorry about the wait — that's not our standard." })
    const draft = await generateReviewResponseDraft({ ...draftInput(), transport })
    expect(draft).toBe("I'm sorry about the wait, that's not our standard.")
  })

  it("empty or non-string output -> null (never a fabricated reply)", async () => {
    for (const bad of [{ draft: "" }, { draft: "   " }, { draft: 42 }, {}, "not an object", [1, 2], null]) {
      const { transport } = stub(bad)
      expect(await generateReviewResponseDraft({ ...draftInput(), transport })).toBeNull()
    }
  })

  it("a throwing transport degrades to null, never throws to the caller", async () => {
    const transport: Transport = async () => {
      throw new Error("model timed out")
    }
    expect(await generateReviewResponseDraft({ ...draftInput(), transport })).toBeNull()
  })
})
