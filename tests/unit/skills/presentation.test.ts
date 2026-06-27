// Insight-quality upgrade — the structured, evidence-forward presentation block.
// Covers each deterministic builder (confidenceBasis, breakoutQuotes, sentimentByCategory,
// headToHead, exemplarSocialPost, estimate, advantage), the presentBrief end-to-end wiring,
// and the checkPresentationGrounded honesty gate.

import { describe, it, expect } from "vitest"
import { buildPresentation, buildPresentationContext } from "@/lib/skills/presentation"
import { presentBrief } from "@/lib/skills/presenter"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { checkPresentationGrounded, collectStoredQuotes, evaluateBrief } from "@/lib/eval/checks"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"

const mkPlay = (over: Partial<EnrichedRecommendation> = {}): EnrichedRecommendation => ({
  title: "t",
  rationale: "r",
  skillId: "reputation",
  ownerRole: "owner",
  kind: "reputation",
  recipe: [{ channel: "c", platforms: [], audience: "a", window: { note: "this week" } }],
  confidence: "medium",
  leverage: { label: "medium", basisInternal: "internal" },
  evidenceRefs: ["review.theme"],
  knowledgeVersion: "x@v1",
  ...over,
})

const ctxOf = (d: Dossier) => buildPresentationContext(d, buildRefIndex(d).allowedRefs)

// ── review-rich dossier (quotes + sentiment-by-category + confidence basis) ───
const reviewDossier = {
  locationId: "loc-1",
  dateKey: "2026-06-26",
  generatedAt: "2026-06-26T00:00:00Z",
  location: {
    entityId: "loc-1",
    kind: "location",
    name: "Test Diner",
    listing: {
      profile: { rating: 4.6 },
      recentReviews: [
        { id: "r1", rating: 2, text: "Service was painfully slow on Friday", date: "2 weeks ago" },
        { id: "r2", rating: 5, text: "The fries are incredible", date: "1 week ago" },
      ],
    },
    reviews: {
      source: "google_places",
      windowDays: 90,
      themes: [
        { theme: "slow service", sentiment: "negative", mentions: 8, examples: ["Service was painfully slow on Friday"] },
        { theme: "great fries", sentiment: "positive", mentions: 12, examples: ["The fries are incredible"] },
        { theme: "pricey", sentiment: "negative", mentions: 5, examples: [] },
      ],
    },
  },
  competitors: [],
  demandCalendar: { events: [], weather: [] },
  ruleOutputs: [
    { insight_type: "review.theme", title: "Slow service", summary: "Guests mention slow service.", confidence: "medium", severity: "warning", evidence: { theme: "slow service", sentiment: "negative", mentions: 8, examples: ["Service was painfully slow on Friday"], windowDays: 90 }, recommendations: [] },
    { insight_type: "review.theme", title: "Great fries", summary: "Guests love the fries.", confidence: "medium", severity: "info", evidence: { theme: "great fries", sentiment: "positive", mentions: 12, examples: ["The fries are incredible"], windowDays: 90 }, recommendations: [] },
    { insight_type: "review.theme", title: "Pricey", summary: "Some guests find it pricey.", confidence: "medium", severity: "warning", evidence: { theme: "pricey", sentiment: "negative", mentions: 5, examples: [], windowDays: 90 }, recommendations: [] },
  ],
} as unknown as Dossier

// ── comparative dossier (head-to-head + advantage + exemplar social post) ──────
const compDossier = {
  locationId: "loc-2",
  dateKey: "2026-06-26",
  generatedAt: "2026-06-26T00:00:00Z",
  location: {
    entityId: "loc-2",
    kind: "location",
    name: "You",
    listing: { profile: { rating: 4.7 } },
    social: { profile: { followerCount: 1000 }, recentPosts: [], aggregateMetrics: {} },
  },
  competitors: [
    {
      entityId: "c1",
      kind: "competitor",
      name: "Rival A",
      listing: { profile: { rating: 4.1 } },
      social: {
        profile: { followerCount: 2000 },
        recentPosts: [
          { platformPostId: "p1", platform: "instagram", text: "Our new smash burger drop!", mediaUrl: "https://xyz.supabase.co/social/c1/instagram/p1.jpg", mediaType: "image", likesCount: 300, commentsCount: 50, sharesCount: 10, viewsCount: null, hashtags: [], createdTime: "2026-06-20" },
          { platformPostId: "p2", platform: "instagram", text: "low engagement post", mediaUrl: "https://cdn.instagram.com/p2.jpg", mediaType: "image", likesCount: 10, commentsCount: 1, sharesCount: 0, viewsCount: null, hashtags: [], createdTime: "2026-06-18" },
        ],
        aggregateMetrics: {},
      },
    },
    { entityId: "c2", kind: "competitor", name: "Rival B", listing: { profile: { rating: 4.3 } } },
  ],
  demandCalendar: { events: [], weather: [] },
  ruleOutputs: [
    { insight_type: "social.engagement_gap", title: "Rival A out-engages you", summary: "Rival A's per-post engagement is higher than yours.", confidence: "high", severity: "warning", evidence: { yourRate: 1.2, competitorRate: 3.4, competitor: "Rival A", platform: "instagram" }, recommendations: [] },
    { insight_type: "review_velocity_rising", title: "Your reviews are rising", summary: "You are gathering reviews faster than before.", confidence: "medium", severity: "info", evidence: { field: "reviewCount", delta: 9 }, recommendations: [] },
  ],
} as unknown as Dossier

describe("confidenceBasis — grounded why-confident lines", () => {
  it("produces one readable line per grounded ref the play cites", () => {
    const play = mkPlay({ evidenceRefs: ["review.theme"] })
    const p = buildPresentation(play, ctxOf(reviewDossier))
    expect(p?.confidenceBasis?.length).toBeGreaterThan(0)
    expect(p!.confidenceBasis![0].source).toContain("Reviews")
    expect(p!.confidenceBasis![0].whatWeSaw).toContain("slow service")
  })
  it("skips an ungrounded ref (no fabricated basis)", () => {
    const play = mkPlay({ evidenceRefs: ["totally.bogus_ref"] })
    const p = buildPresentation(play, ctxOf(reviewDossier))
    expect(p?.confidenceBasis).toBeUndefined()
  })
})

describe("breakoutQuotes — verbatim + attributed", () => {
  it("attaches the verbatim review quote with its rating + date", () => {
    const play = mkPlay({ evidenceRefs: ["review.theme"] })
    const p = buildPresentation(play, ctxOf(reviewDossier))
    const q = p?.breakoutQuotes?.find((x) => x.text === "Service was painfully slow on Friday")
    expect(q).toBeDefined()
    expect(q!.rating).toBe(2)
    expect(q!.date).toBe("2 weeks ago")
    expect(q!.source).toBe("review.theme")
  })
  it("never invents a quote — every quote byte-matches a stored example", () => {
    const play = mkPlay({ evidenceRefs: ["review.theme"] })
    const p = buildPresentation(play, ctxOf(reviewDossier))
    const stored = collectStoredQuotes(reviewDossier.ruleOutputs)
    for (const q of p?.breakoutQuotes ?? []) expect(stored.has(q.text)).toBe(true)
  })
  it("does not attach quotes to a non-review play", () => {
    const play = mkPlay({ evidenceRefs: ["social.engagement_gap"], category: "social" })
    const p = buildPresentation(play, ctxOf(reviewDossier))
    expect(p?.breakoutQuotes).toBeUndefined()
  })
})

describe("sentimentByCategory — own-review category breakdown", () => {
  it("derives category shares + dominant sentiment from real mention counts", () => {
    const play = mkPlay({ evidenceRefs: ["review.theme"] })
    const p = buildPresentation(play, ctxOf(reviewDossier))
    const cats = p?.sentimentByCategory ?? []
    const food = cats.find((c) => c.category === "food")
    const wait = cats.find((c) => c.category === "wait")
    const price = cats.find((c) => c.category === "price")
    expect(food?.direction).toBe("positive")
    expect(wait?.direction).toBe("negative")
    expect(price?.direction).toBe("negative")
    // shares are 0-100 and the dominant (food, 12/25) leads
    expect(cats[0].category).toBe("food")
    for (const c of cats) expect(c.pct).toBeGreaterThanOrEqual(0)
  })
})

describe("headToHead — decodable you-vs-set / you-vs-competitor", () => {
  it("compares Google rating to the local set average for a positioning play", () => {
    const play = mkPlay({ skillId: "positioning", category: "positioning", evidenceRefs: ["review_velocity_rising"] })
    const p = buildPresentation(play, ctxOf(compDossier))
    const rating = p?.headToHead?.find((h) => h.metric === "Google rating")
    expect(rating).toBeDefined()
    expect(rating!.lead).toBe("you") // 4.7 vs set avg 4.2
    expect(rating!.you).toContain("4.7")
  })
  it("reads a social engagement delta from the cited rule (competitor leads)", () => {
    const play = mkPlay({ skillId: "social-counter", category: "social", evidenceRefs: ["social.engagement_gap"] })
    const p = buildPresentation(play, ctxOf(compDossier))
    const eng = p?.headToHead?.find((h) => h.metric === "Social engagement")
    expect(eng).toBeDefined()
    expect(eng!.lead).toBe("them")
    expect(eng!.setOrCompetitor).toContain("Rival A")
  })
})

describe("advantage — press-the-advantage vs steal-the-cue", () => {
  it("flags true when a winning ref is cited", () => {
    const play = mkPlay({ skillId: "positioning", category: "positioning", evidenceRefs: ["review_velocity_rising"] })
    const p = buildPresentation(play, ctxOf(compDossier))
    expect(p?.advantage).toBe(true)
  })
  it("flags false when only a gap/losing ref is cited", () => {
    const play = mkPlay({ skillId: "social-counter", category: "social", evidenceRefs: ["social.engagement_gap"] })
    const p = buildPresentation(play, ctxOf(compDossier))
    expect(p?.advantage).toBe(false)
  })
})

describe("exemplarSocialPost — embed the competitor's winning post", () => {
  it("picks the highest-rate supabase-hosted post of the cited competitor", () => {
    const play = mkPlay({ skillId: "social-counter", category: "social", evidenceRefs: ["social.engagement_gap"] })
    const p = buildPresentation(play, ctxOf(compDossier))
    const ex = p?.exemplarSocialPost
    expect(ex).toBeDefined()
    expect(ex!.competitor).toBe("Rival A")
    expect(ex!.mediaUrl).toContain("supabase")
    expect(ex!.caption).toBe("Our new smash burger drop!")
    expect(ex!.likes).toBe(300)
    expect(ex!.engagementPct).toBe(18) // (300+50+10)/2000 = 18.0%
  })
  it("omits the post when the only image is not in our storage (not embeddable)", () => {
    const noStore = JSON.parse(JSON.stringify(compDossier)) as Dossier
    // strip the supabase post, leaving only the cdn one
    noStore.competitors[0].social!.recentPosts = [noStore.competitors[0].social!.recentPosts[1]]
    const play = mkPlay({ skillId: "social-counter", category: "social", evidenceRefs: ["social.engagement_gap"] })
    const p = buildPresentation(play, ctxOf(noStore))
    expect(p?.exemplarSocialPost).toBeUndefined()
  })
  it("never attaches an exemplar to a non-social play", () => {
    const play = mkPlay({ skillId: "positioning", category: "positioning", evidenceRefs: ["social.engagement_gap"] })
    const p = buildPresentation(play, ctxOf(compDossier))
    expect(p?.exemplarSocialPost).toBeUndefined()
  })
  it("strips a $ / POS competitor caption but keeps the post (no money line in our copy)", () => {
    const moneyCaption = JSON.parse(JSON.stringify(compDossier)) as Dossier
    moneyCaption.competitors[0].social!.recentPosts[0].text = "$5 margarita Monday — 20% off apps!"
    const play = mkPlay({ skillId: "social-counter", category: "social", evidenceRefs: ["social.engagement_gap"] })
    const p = buildPresentation(play, ctxOf(moneyCaption))
    expect(p?.exemplarSocialPost).toBeDefined()
    expect(p!.exemplarSocialPost!.caption).toBe("")
  })
  it("falls back to followers for the engagement rate when viewsCount is a literal 0", () => {
    const zeroViews = JSON.parse(JSON.stringify(compDossier)) as Dossier
    const post = zeroViews.competitors[0].social!.recentPosts[0]
    post.viewsCount = 0
    post.likesCount = 100
    post.commentsCount = 20
    post.sharesCount = 5
    const play = mkPlay({ skillId: "social-counter", category: "social", evidenceRefs: ["social.engagement_gap"] })
    const p = buildPresentation(play, ctxOf(zeroViews))
    // (100+20+5)/2000 followers = 6.25% — must NOT be omitted just because views === 0
    expect(p?.exemplarSocialPost?.engagementPct).toBe(6.3)
  })
})

describe("estimate — honest, %-framed, never $ / POS", () => {
  it("mirrors a grounded, non-money reach as a structured estimate", () => {
    const play = mkPlay({ evidenceRefs: ["review.theme"], leverage: { label: "high", reach: "around 500 nearby fans", basisInternal: "x" } })
    const p = buildPresentation(play, ctxOf(reviewDossier))
    expect(p?.estimate?.value).toBe("around 500 nearby fans")
    expect(p?.estimate?.unit).toBe("count")
    expect(p?.estimate?.isEstimated).toBe(true)
  })
  it("refuses a $ / POS reach (no money estimate ever surfaces)", () => {
    const play = mkPlay({ evidenceRefs: ["review.theme"], leverage: { label: "high", reach: "$2,000 in weekly sales", basisInternal: "x" } })
    const p = buildPresentation(play, ctxOf(reviewDossier))
    expect(p?.estimate).toBeUndefined()
  })
})

describe("presentBrief — end-to-end wiring + fail-soft", () => {
  it("attaches the presentation block to a play and stays eval-clean", () => {
    const brief: Brief = {
      locationId: "loc-1",
      dateKey: "2026-06-26",
      headline: "h",
      deck: "d",
      plays: [mkPlay({ evidenceRefs: ["review.theme"] })],
      asOf: "2026-06-26T00:00:00Z",
    }
    const out = presentBrief(brief, reviewDossier)
    expect(out.plays[0].presentation).toBeDefined()
    expect(out.plays[0].presentation!.breakoutQuotes?.length).toBeGreaterThan(0)
    const index = buildRefIndex(reviewDossier)
    const stored = collectStoredQuotes(reviewDossier.ruleOutputs)
    expect(evaluateBrief({ plays: out.plays }, index, undefined, stored).ok).toBe(true)
  })
  it("never throws on an unexpected dossier shape (block simply absent)", () => {
    const brief: Brief = {
      locationId: "l",
      dateKey: "2026-06-26",
      headline: "h",
      deck: "d",
      plays: [mkPlay()],
      asOf: "2026-06-26T00:00:00Z",
    }
    const out = presentBrief(brief, { ruleOutputs: [] } as unknown as Dossier)
    expect(out.plays).toHaveLength(1)
  })
})

describe("checkPresentationGrounded — honesty gate", () => {
  const index = buildRefIndex(reviewDossier)
  const stored = collectStoredQuotes(reviewDossier.ruleOutputs)

  it("passes a clean, grounded presentation block", () => {
    const out = presentBrief(
      { locationId: "loc-1", dateKey: "2026-06-26", headline: "h", deck: "d", asOf: "z", plays: [mkPlay({ evidenceRefs: ["review.theme"] })] },
      reviewDossier,
    )
    expect(checkPresentationGrounded(out.plays[0], 0, index, stored)).toHaveLength(0)
  })
  it("rejects a fabricated (non-verbatim) breakout quote", () => {
    const play = mkPlay({ presentation: { breakoutQuotes: [{ text: "This quote was never in any review", source: "review.theme" }] } })
    const vios = checkPresentationGrounded(play, 0, index, stored)
    expect(vios.some((v) => v.code === "presentation_quote_not_verbatim")).toBe(true)
  })
  it("rejects an ungrounded quote source", () => {
    const play = mkPlay({ presentation: { breakoutQuotes: [{ text: "The fries are incredible", source: "totally.bogus" }] } })
    const vios = checkPresentationGrounded(play, 0, index, stored)
    expect(vios.some((v) => v.code === "presentation_quote_ungrounded_source")).toBe(true)
  })
  it("rejects a $ / POS estimate", () => {
    const play = mkPlay({ presentation: { estimate: { value: "$500 in revenue", unit: "count", basis: "x", isEstimated: true } } })
    const vios = checkPresentationGrounded(play, 0, index, stored)
    expect(vios.some((v) => v.code === "presentation_estimate_money_or_pos")).toBe(true)
  })
  it("rejects an out-of-range sentiment percentage", () => {
    const play = mkPlay({ presentation: { sentimentByCategory: [{ category: "food", pct: 140, direction: "positive" }] } })
    const vios = checkPresentationGrounded(play, 0, index, stored)
    expect(vios.some((v) => v.code === "presentation_sentiment_pct_oob")).toBe(true)
  })
  it("rejects a $ / POS competitor caption that slipped into an exemplar post", () => {
    const play = mkPlay({
      presentation: {
        exemplarSocialPost: { competitor: "Rival A", platform: "instagram", mediaUrl: "https://x.supabase.co/p.jpg", caption: "$5 margarita Monday", source: "review.theme" },
      },
    })
    const vios = checkPresentationGrounded(play, 0, index, stored)
    expect(vios.some((v) => v.code === "presentation_exemplar_caption_money_or_pos")).toBe(true)
  })
})
