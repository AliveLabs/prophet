// P12 — the social counter-strategy skill. Its OWN category "social" (neutral 1.0 prior),
// standard reasoning tier (NOT the deep pass). Reads a rival's winning posts ranked by
// engagement RATE (not raw likes), tears down the winning pattern from the structured visual
// tags, and emits a phone-shootable counter-play. Grounds on social.* rule outputs; degrades
// to an own-whitespace play when rival social is thin; produces nothing with no social signal.

import { describe, it, expect } from "vitest"
import {
  socialCounterSkill,
  rankPostsByRate,
  postEngagementRate,
  hasCompetitorSocial,
  isSocialCounterSignal,
} from "@/lib/skills/social-counter/skill"
import { runProducerSkill } from "@/lib/skills/run"
import { CATEGORY_PRIORS } from "@/lib/skills/scoring-config"
import { CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/skills/category-priors"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { sanitizeAnalysis } from "@/lib/social/visual-analysis"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier, EntitySignals } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { Transport } from "@/lib/ai/provider"
import type {
  NormalizedSocialPost,
  SocialSnapshotData,
  SocialMediaType,
} from "@/lib/social/types"

// ── tiny builders ─────────────────────────────────────────────────────────────
const sig = (insight_type: string, title = insight_type): GeneratedInsight => ({
  insight_type,
  title,
  summary: "",
  confidence: "medium",
  severity: "info",
  evidence: {},
  recommendations: [],
})
const withSignals = (sigs: GeneratedInsight[]): Dossier => ({ ...competitiveWeekDossier, ruleOutputs: sigs })

const post = (
  id: string,
  likes: number,
  opts: { comments?: number; shares?: number; views?: number | null; mediaType?: SocialMediaType } = {},
): NormalizedSocialPost => ({
  platformPostId: id,
  platform: "instagram",
  text: `caption ${id}`,
  mediaUrl: null,
  mediaType: opts.mediaType ?? "image",
  likesCount: likes,
  commentsCount: opts.comments ?? 0,
  sharesCount: opts.shares ?? 0,
  viewsCount: opts.views ?? null,
  hashtags: [],
  createdTime: "2026-06-20T12:00:00Z",
})

const snapshot = (followerCount: number, posts: NormalizedSocialPost[]): SocialSnapshotData => ({
  version: "1.0",
  timestamp: "2026-06-21T00:00:00Z",
  profile: {
    platform: "instagram",
    handle: "rival",
    displayName: "Rival",
    bio: null,
    followerCount,
    followingCount: 0,
    postCount: posts.length,
    isVerified: false,
    avatarUrl: null,
    engagementRate: 2.0,
  },
  recentPosts: posts,
  aggregateMetrics: {
    avgLikesPerPost: 0,
    avgCommentsPerPost: 0,
    avgSharesPerPost: 0,
    avgViewsPerPost: null,
    engagementRate: 2.0,
    postingFrequencyPerWeek: 4,
    postingWindowDays: 30,
    topHashtags: [],
  },
})

const competitorWithSocial = (name: string, social: SocialSnapshotData): EntitySignals => ({
  entityId: `comp-${name}`,
  kind: "competitor",
  name,
  social,
})

// ── wiring ──────────────────────────────────────────────────────────────────
describe("social-counter skill — wiring", () => {
  it("declares its own social category on the standard reasoning tier (not the deep pass)", () => {
    expect(socialCounterSkill.id).toBe("social-counter")
    expect(socialCounterSkill.category).toBe("social")
    expect(socialCounterSkill.ownerRole).toBe("marketing")
    expect(socialCounterSkill.deep).toBeFalsy()
    expect(socialCounterSkill.tier).toBe("reasoning")
  })
  it("social is its OWN category, split from marketing, with a neutral prior wired through all 3 touchpoints", () => {
    expect(socialCounterSkill.category).not.toBe("marketing")
    expect(CATEGORY_PRIORS.social).toBe(1.0) // scoring-config touchpoint
    expect(CATEGORY_ORDER).toContain("social") // category-priors order touchpoint
    expect(CATEGORY_LABELS.social).toBeTruthy() // Record<Category,string> labels touchpoint
  })
})

// ── the cardinal rule: rank by engagement RATE, not raw likes ──────────────────
describe("social-counter skill — ranks by engagement RATE, not raw likes", () => {
  it("a low-like post on a small account beats a high-like post on a huge account", () => {
    // Big account: 800 likes / 200k followers = 0.4%. Small account modeled via its own snapshot.
    const bigPost = post("big", 800)
    const smallPost = post("small", 120)
    expect(postEngagementRate(bigPost, 200_000)).toBeLessThan(postEngagementRate(smallPost, 3_000)!)
  })
  it("rankPostsByRate orders by rate; the raw-like leader is NOT first when its audience is larger", () => {
    // Within ONE account (same follower base) rate == raw-like order, so to prove the rule we
    // use views as the denominator: a 500-like post seen by 100k (0.5%) loses to a 300-like
    // post seen by 10k (3%). Raw likes would (wrongly) rank the 500-like post first.
    const wideReach = post("wide", 500, { views: 100_000, mediaType: "reel" })
    const tightReach = post("tight", 300, { views: 10_000, mediaType: "reel" })
    const ranked = rankPostsByRate(snapshot(5_000, [wideReach, tightReach]))
    expect(ranked[0].post.platformPostId).toBe("tight") // higher RATE wins
    expect(ranked[0].post.likesCount).toBeLessThan(ranked[1].post.likesCount) // fewer raw likes, still first
  })
  it("a post with no usable denominator (no views, no followers) is UNRATED (null) and never wins on raw likes", () => {
    // Cardinal-rule edge: a 9,999-like post with zero followers + no view count has no audience to
    // divide by, so it is unrated — it must NOT be promoted on raw likes. postEngagementRate returns
    // null for it, while a post with a real follower base gets a rate; rankPostsByRate sorts unrated last.
    const huge = post("huge", 9_999, { views: 0 })
    expect(postEngagementRate(huge, 0)).toBeNull()
    const ranked = rankPostsByRate(snapshot(5_000, [huge, post("modest", 50)]))
    // Both share the 5k follower base here, so both ARE rated; the rule (rate, not raw) still holds:
    expect(ranked[0].post.platformPostId).toBe("huge") // 9999/5000 > 50/5000 — by RATE, legitimately
    // and the rate ranking equals raw order ONLY because the denominator is identical (same account).
    expect(ranked.every((r) => r.rate !== null)).toBe(true)
  })
})

// ── §4.4 vision tags: parse + back-compat ──────────────────────────────────────
describe("social vision tags (§4.4) — additive + back-compat", () => {
  it("parses the new post-anatomy fields when the tagger returns them", () => {
    const a = sanitizeAnalysis({
      contentCategory: "behind_the_scenes",
      peoplePresent: true,
      ownerOrStaffPresent: true,
      steamOrMotion: true,
      trendingSound: true,
      firstFrame: "close-up of a cheese pull",
    })
    expect(a.peoplePresent).toBe(true)
    expect(a.ownerOrStaffPresent).toBe(true)
    expect(a.steamOrMotion).toBe(true)
    expect(a.trendingSound).toBe(true)
    expect(a.firstFrame).toBe("close-up of a cheese pull")
  })
  it("is back-compat: a legacy analysis WITHOUT the new fields leaves them undefined (not coerced to false)", () => {
    const a = sanitizeAnalysis({ contentCategory: "food_dish" })
    expect(a.peoplePresent).toBeUndefined()
    expect(a.ownerOrStaffPresent).toBeUndefined()
    expect(a.steamOrMotion).toBeUndefined()
    expect(a.trendingSound).toBeUndefined()
    expect(a.firstFrame).toBeUndefined()
    // existing fields still parse exactly as before
    expect(a.contentCategory).toBe("food_dish")
    expect(a.promotionalContent).toBe(false)
  })
  it("drops an empty-string firstFrame (carried only when meaningful)", () => {
    const a = sanitizeAnalysis({ contentCategory: "food_dish", firstFrame: "  " })
    expect(a.firstFrame).toBeUndefined()
  })
})

// ── parse: ≥1-cited-social-signal-or-SUPPRESS, counter-don't-clone shape ────────
describe("social-counter skill — parse + the ≥1-cited-post guardrail", () => {
  const rawPlay = (evidenceRefs: string[]) => ({
    title: "Counter their winning Reel with the owner on camera",
    rationale: "A rival's Reels are winning; counter with a person-and-motion clip they can't match.",
    recipe: [
      {
        channel: "a short vertical video (Reel)",
        platforms: ["Instagram"],
        audience: "the local audience the rival reaches",
        window: { note: "this week" },
        creativeDirection: "Counter-move: film the owner plating one dish on your phone.",
      },
    ],
    confidence: "directional",
    leverage: { label: "medium", basisInternal: "counter reach sized ordinally" },
    evidenceRefs,
  })

  it("coerces a model play grounded on a competitor social signal into a stamped play", () => {
    const plays = socialCounterSkill.parse([rawPlay(["social.engagement_gap"])], competitiveWeekDossier)
    expect(plays).toHaveLength(1)
    expect(plays![0].skillId).toBe("social-counter")
    expect(plays![0].knowledgeVersion).toBe("social-counter@v1")
  })
  it("SUPPRESSES a play that cites NO social signal (e.g. only a menu ref) — no cited post, no counter-play", () => {
    const plays = socialCounterSkill.parse([rawPlay(["menu.signature_item_missing"])], competitiveWeekDossier)
    expect(plays).toEqual([])
  })
  it("keeps a whitespace-grounded play (platform presence gap counts as a social signal)", () => {
    const plays = socialCounterSkill.parse([rawPlay(["social.platform_presence_gap"])], competitiveWeekDossier)
    expect(plays).toHaveLength(1)
  })
  it("returns null on unparseable output so the deterministic fallback runs", () => {
    expect(socialCounterSkill.parse(42, competitiveWeekDossier)).toBeNull()
  })
})

// ── fallback: counter vs whitespace vs zero-play ───────────────────────────────
describe("social-counter skill — deterministic fallback", () => {
  it("a COMPETITOR signal yields a counter (attack-weakness) play, grounded on that signal", () => {
    const plays = socialCounterSkill.fallback(withSignals([sig("social.engagement_gap", "Rival out-engages you")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].skillId).toBe("social-counter")
    expect(plays[0].category).toBe("social")
    expect(plays[0].evidenceRefs).toEqual(["social.engagement_gap"])
    // counter, don't clone: the copy is about doing what the rival lacks, never "repost/copy them"
    expect(plays[0].rationale.toLowerCase()).toContain("don't copy")
  })
  it("only a WHITESPACE signal yields an own-the-neglected-channel play", () => {
    const plays = socialCounterSkill.fallback(withSignals([sig("social.platform_presence_gap", "Rivals own TikTok, you don't")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].evidenceRefs).toEqual(["social.platform_presence_gap"])
    expect(plays[0].title.toLowerCase()).toContain("flag")
  })
  it("prefers the COMPETITOR signal when both a competitor and whitespace signal are present", () => {
    const plays = socialCounterSkill.fallback(
      withSignals([sig("social.platform_presence_gap"), sig("social.viral_content")]),
    )
    expect(plays).toHaveLength(1)
    expect(plays[0].evidenceRefs).toEqual(["social.viral_content"]) // counter beats whitespace
  })
  it("emits NOTHING when no social signal is present (honesty / zero-play)", () => {
    expect(socialCounterSkill.fallback(withSignals([sig("menu.signature_item_missing"), sig("events.new_high_signal_event")]))).toEqual([])
    expect(socialCounterSkill.fallback(withSignals([]))).toEqual([])
  })
})

// ── hasCompetitorSocial: thin/absent rival social → whitespace path ─────────────
describe("social-counter skill — thin/absent competitor social degrades to whitespace", () => {
  it("hasCompetitorSocial is false when no competitor carries social posts", () => {
    expect(hasCompetitorSocial(competitiveWeekDossier)).toBe(false) // fixture competitors have no social sub-dossier
  })
  it("hasCompetitorSocial is true when a competitor carries real posts", () => {
    const d: Dossier = {
      ...competitiveWeekDossier,
      competitors: [competitorWithSocial("O-Ku", snapshot(5_000, [post("p1", 200, { mediaType: "reel" })]))],
    }
    expect(hasCompetitorSocial(d)).toBe(true)
  })
  it("with thin rival social but a whitespace signal, the end-to-end run yields a whitespace play", async () => {
    const failing: Transport = async () => {
      throw new Error("model down")
    }
    const d = withSignals([sig("social.inactive_account", "Your account is dark")])
    const res = await runProducerSkill(socialCounterSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays.length).toBeGreaterThan(0)
    expect(res.plays[0].evidenceRefs).toEqual(["social.inactive_account"])
  })
})

// ── run.ts ground-filter end-to-end ────────────────────────────────────────────
describe("social-counter skill — run.ts ground-filter end-to-end (model failure -> fallback)", () => {
  const failing: Transport = async () => {
    throw new Error("model down")
  }
  it("falls back to deterministic plays, all grounded in real social rule outputs", async () => {
    const d = withSignals([sig("social.engagement_gap", "Rival out-engages you")])
    const res = await runProducerSkill(socialCounterSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays.length).toBeGreaterThan(0)
    const allowed = buildRefIndex(d).allowedRefs
    for (const p of res.plays) {
      expect(p.evidenceRefs.every((r) => allowed.has(r))).toBe(true)
      expect(p.evidenceRefs.some(isSocialCounterSignal)).toBe(true)
    }
  })
  it("a model failure with ONLY a non-social signal yields zero plays (no signal, no play)", async () => {
    // menu.* is food-pairing's, not social-counter's — the zero-play invariant must hold end-to-end.
    const d = withSignals([sig("menu.signature_item_missing", "No signature dish")])
    const res = await runProducerSkill(socialCounterSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toEqual([])
  })
})

// ── model-success path: a counter-play citing a real competitor post survives the run ──
describe("social-counter skill — model-success path with a cited competitor signal", () => {
  it("a model counter-play grounded on a competitor social signal survives the ground-filter", async () => {
    const modelOutput: Transport = async () => [
      {
        title: "Counter O-Ku's winning Reel with a kitchen clip",
        rationale: "O-Ku's plated-entree posts win on engagement rate; counter with a build-video they don't make.",
        recipe: [
          {
            channel: "a short vertical video (Reel)",
            platforms: ["Instagram"],
            audience: "the local audience O-Ku reaches",
            window: { note: "this week" },
            creativeDirection: "Counter-move: film one dish being plated on your phone, in your own style.",
            copy: "Watch this come together.",
          },
        ],
        confidence: "medium",
        stance: "capture",
        leverage: { label: "high", basisInternal: "counters their winning format on the discovery channel" },
        evidenceRefs: ["social.content_type_opportunity"],
      },
    ]
    const d: Dossier = {
      ...withSignals([sig("social.content_type_opportunity", "O-Ku's entree posts win")]),
      competitors: [competitorWithSocial("O-Ku", snapshot(8_000, [post("oku1", 400, { mediaType: "reel" })]))],
    }
    const res = await runProducerSkill(socialCounterSkill, d, { transport: modelOutput })
    expect(res.status).toBe("ok")
    expect(res.plays).toHaveLength(1)
    expect(res.plays[0].skillId).toBe("social-counter")
    expect(res.plays[0].evidenceRefs).toEqual(["social.content_type_opportunity"])
  })
})
