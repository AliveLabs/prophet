// social-counter@v2 test suite — the sixth mastery-program retrofit. Mirrors the sibling
// suites (positioning-skill.test.ts / local-demand-skill.test.ts are the closest templates)
// and SUPERSEDES tests/unit/skills/social-counter.test.ts: that file asserted the @v1 version
// string, the two hand-listed intake sets (now widened), and a severity-blind fallback (now
// gated). This suite covers all those concerns plus the v2 additions.
//
// KEEPS the v1 behaviors that KEEP their v1 form (the retrofit contract):
//   - the engagement-RATE-not-raw-likes ranking incl. the unrated-post rule;
//   - the COMPETITOR/WHITESPACE partition + the zero-play invariant;
//   - the per-competitor teardown built from the §4.4 vision tags.
// TESTS the v2 additions:
//   - the widened SINGLE-prefix intake (the 30 live social.* types v1 dropped now ground);
//   - the OWN-WIN third class + the entity-attribution rule;
//   - the template kill-list (copy-their-post / engagement-bait / buy-followers / post-more /
//     parroted canned recs);
//   - the stance backstop;
//   - the SEVERITY-GATED fallback (the v1 change) + self-consistency of the kept fallback copy;
//   - the @v2 version string + SOCIAL_COUNTER_ARCHETYPES;
//   - the knowledge budget + load-bearing sections.

import { describe, it, expect } from "vitest"
import {
  socialCounterSkill,
  rankPostsByRate,
  postEngagementRate,
  hasCompetitorSocial,
  isSocialCounterSignal,
  isCompetitorSocialSignal,
  isWhitespaceSocialSignal,
  isOwnWinSocialSignal,
  isTemplateAdvice,
  SOCIAL_COUNTER_ARCHETYPES,
} from "@/lib/skills/social-counter/skill"
import { SOCIAL_COUNTER_KNOWLEDGE } from "@/lib/skills/social-counter/knowledge"
import { runProducerSkill } from "@/lib/skills/run"
import { CATEGORY_PRIORS } from "@/lib/skills/scoring-config"
import { CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/skills/category-priors"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { lintVoice } from "@/lib/eval/voice-rules"
import { sanitizeAnalysis } from "@/lib/social/visual-analysis"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier, EntitySignals } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { Transport } from "@/lib/ai/provider"
import type { NormalizedSocialPost, SocialSnapshotData, SocialMediaType } from "@/lib/social/types"

const KNOWLEDGE_VERSION = "social-counter@v2"

// ── tiny builders ─────────────────────────────────────────────────────────────
const sig = (insight_type: string, title = insight_type, severity = "info"): GeneratedInsight => ({
  insight_type,
  title,
  summary: "",
  confidence: "medium",
  severity: severity as GeneratedInsight["severity"],
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
    expect(socialCounterSkill.temperature).toBe(0.6) // kept from v1 on purpose
  })
  it("social is its OWN category, split from marketing, with a neutral prior wired through all 3 touchpoints", () => {
    expect(socialCounterSkill.category).not.toBe("marketing")
    expect(CATEGORY_PRIORS.social).toBe(1.0) // scoring-config touchpoint
    expect(CATEGORY_ORDER).toContain("social") // category-priors order touchpoint
    expect(CATEGORY_LABELS.social).toBeTruthy() // Record<Category,string> labels touchpoint
  })
  it("carries the P14 learning hook with the social lead-domain", () => {
    expect(socialCounterSkill.learning?.playTypeLeadDomain).toBe("social")
    expect(socialCounterSkill.learning?.streams).toEqual(["external", "click", "ask"])
  })
})

describe("SOCIAL_COUNTER_ARCHETYPES — stable feedback-learning keys", () => {
  it("7 archetypes, no duplicates", () => {
    expect(SOCIAL_COUNTER_ARCHETYPES.length).toBe(7)
    expect(new Set(SOCIAL_COUNTER_ARCHETYPES).size).toBe(SOCIAL_COUNTER_ARCHETYPES.length)
  })
})

// ── the cardinal rule: rank by engagement RATE, not raw likes (KEPT from v1) ────
describe("social-counter skill — ranks by engagement RATE, not raw likes (kept verbatim)", () => {
  it("a low-like post on a small account beats a high-like post on a huge account", () => {
    const bigPost = post("big", 800)
    const smallPost = post("small", 120)
    expect(postEngagementRate(bigPost, 200_000)).toBeLessThan(postEngagementRate(smallPost, 3_000)!)
  })
  it("rankPostsByRate orders by rate; the raw-like leader is NOT first when its audience is larger", () => {
    const wideReach = post("wide", 500, { views: 100_000, mediaType: "reel" })
    const tightReach = post("tight", 300, { views: 10_000, mediaType: "reel" })
    const ranked = rankPostsByRate(snapshot(5_000, [wideReach, tightReach]))
    expect(ranked[0].post.platformPostId).toBe("tight") // higher RATE wins
    expect(ranked[0].post.likesCount).toBeLessThan(ranked[1].post.likesCount) // fewer raw likes, still first
  })
  it("a post with no usable denominator (no views, no followers) is UNRATED (null) and never wins on raw likes", () => {
    const huge = post("huge", 9_999, { views: 0 })
    expect(postEngagementRate(huge, 0)).toBeNull()
    const ranked = rankPostsByRate(snapshot(5_000, [huge, post("modest", 50)]))
    expect(ranked[0].post.platformPostId).toBe("huge") // 9999/5000 > 50/5000 — by RATE, legitimately
    expect(ranked.every((r) => r.rate !== null)).toBe(true)
  })
  it("an unrated post sorts BELOW any rate-scored post (the unrated-last rule)", () => {
    // wide: 5 likes / 1000 views = 0.5% (rated). unrated: 9999 likes, no views, no followers.
    const rated = post("rated", 5, { views: 1000, mediaType: "reel" })
    const unrated = post("unrated", 9_999, { views: 0 })
    const ranked = rankPostsByRate(snapshot(0, [unrated, rated])) // 0 followers -> unrated has no denom
    expect(ranked[0].post.platformPostId).toBe("rated") // the rated post wins despite 5 raw likes
    expect(ranked[1].rate).toBeNull()
  })
})

// ── §4.4 vision tags: parse + back-compat (KEPT — the teardown material) ────────
describe("social vision tags (§4.4) — additive + back-compat (kept)", () => {
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
    expect(a.contentCategory).toBe("food_dish")
    expect(a.promotionalContent).toBe(false)
  })
})

// ── the widened, verified intake (the v2 inversion) ────────────────────────────
describe("isSocialCounterSignal — the single broad social. prefix (all 44 live types, not v1's 14)", () => {
  it.each([
    // v1 already read these
    "social.engagement_gap",
    "social.viral_content",
    "social.content_type_opportunity",
    "social.platform_presence_gap",
    "social.inactive_account",
    // the visual-insights.ts teardown material v1 DROPPED
    "social.visual_quality_gap",
    "social.food_photography_gap",
    "social.crowd_perception_gap",
    "social.professional_content_gap",
    "social.ugc_dominance",
    "social.video_content_opportunity",
    "social.seasonal_content_gap",
    "social.behind_scenes_opportunity",
    // own-win types v1 never intook
    "social.engagement_outperform",
    "social.top_performing_post",
    "social.content_variety_good",
    // cross-signal correlations (context-only, still in-family)
    "social.cross_weather_opportunity",
    // type:key refs resolve too (buildRefIndex adds them)
    "social.engagement_gap:competitor",
  ])("claims %s", (t) => {
    expect(isSocialCounterSignal(t)).toBe(true)
  })

  it.each([
    "visual.category_shift", // marketing's — a rival's visual upgrade early-warning
    "visual.professional_upgrade", // marketing's — same
    "events.competitor_hosting_event", // CEDED to marketing (event-series conquest)
    "events.competitor_event_cadence", // CEDED to marketing
    "photo.promotion_detected", // marketing's conquest lane
    "photo.price_change", // positioning/marketing shared, not social-counter
    "menu.signature_item_missing", // positioning's
    "review.theme", // reputation's
    "seo_competitor_overtake", // marketing's
    "traffic.surge", // operations/local-demand
  ])("leaves %s to siblings", (t) => {
    expect(isSocialCounterSignal(t)).toBe(false)
  })
})

describe("the COMPETITOR / WHITESPACE / OWN-WIN routing (widened, mutually exclusive)", () => {
  it("routes verified competitor teardown types (incl. the v1-dropped visual ones)", () => {
    for (const t of [
      "social.engagement_gap",
      "social.competitor_promo_blitz",
      "social.visual_quality_gap",
      "social.food_photography_gap",
      "social.crowd_perception_gap",
      "social.video_content_opportunity", // FIX: v1 mislabeled this a WHITESPACE type
    ]) {
      expect(isCompetitorSocialSignal(t)).toBe(true)
      expect(isWhitespaceSocialSignal(t)).toBe(false)
      expect(isOwnWinSocialSignal(t)).toBe(false)
    }
  })
  it("routes verified own-gap whitespace types", () => {
    for (const t of [
      "social.platform_presence_gap",
      "social.inactive_account",
      "social.engagement_below_average",
      "social.content_mix_imbalance",
      "social.brand_consistency_low",
      "social.food_photography_weak",
    ]) {
      expect(isWhitespaceSocialSignal(t)).toBe(true)
      expect(isCompetitorSocialSignal(t)).toBe(false)
      expect(isOwnWinSocialSignal(t)).toBe(false)
    }
  })
  it("recognizes own-WIN types as their own class (never a rival to counter, never a gap)", () => {
    for (const t of [
      "social.engagement_outperform",
      "social.engagement_excellent",
      "social.top_performing_post",
      "social.visual_quality_win",
      "social.content_variety_good",
      "social.visual_drives_engagement",
    ]) {
      expect(isOwnWinSocialSignal(t)).toBe(true)
      expect(isCompetitorSocialSignal(t)).toBe(false)
      expect(isWhitespaceSocialSignal(t)).toBe(false)
    }
  })
  it("video_content_opportunity is a COMPETITOR read (the v1 misrouting fix)", () => {
    // v1 listed social.video_content_opportunity in WHITESPACE_SOCIAL_TYPES, but its
    // generator (checkVideoContentOpportunity) fires on a COMPETITOR profile — it is a
    // rival's format win, i.e. teardown material, not an own gap.
    expect(isCompetitorSocialSignal("social.video_content_opportunity")).toBe(true)
    expect(isWhitespaceSocialSignal("social.video_content_opportunity")).toBe(false)
  })
})

// ── the template kill-list ──────────────────────────────────────────────────────
describe("isTemplateAdvice — the banned classes and parroted canned recs cannot survive", () => {
  it.each([
    // copy-their-post class
    "Copy their winning Reel and post it on your feed",
    "Recreate the competitor's post with your own dishes",
    "Repost that viral video to your account",
    "Post the same content they did last week",
    "Use their caption on your version",
    // engagement-bait
    "Run a follow-for-follow campaign to grow your audience",
    "Do a like-for-like exchange with local accounts",
    "Ask people to comment for a chance to win",
    "Tag three friends to enter the draw",
    "Host a giveaway to gain followers fast",
    // buy / pod / bots
    "Buy followers to close the gap with the rival",
    "Join an engagement pod to boost your reach",
    "Use bots to inflate your like count",
    // generic post-more (marketing's dead class, killed here too)
    "Post more consistently to beat their cadence",
    "Be more active on social this month",
    "Boost your social media presence with daily posts",
    // parroted canned rule recs (verified literals in the generators)
    "Study what made this content perform well",
    "Analyze competitor's top-performing content",
    "Consider a counter-promotion or loyalty offer",
    "Replicate the format and style of your top-performing post",
    "Schedule posts in advance to stay consistent",
    "Invest in better photography for social posts",
    "Improve food styling and photography",
    "Encourage and repost customer content",
  ])("kills: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(true)
  })

  it.each([
    // the bar: real counter/whitespace plays survive
    "Film fifteen seconds of you plating the same course on your phone and post it as a Reel",
    "Their entree Reels win on polish but never show a person; put your hands and voice on camera instead",
    "In a feed full of sale banners, post one calm clip of your signature dish being made, no discount",
    "Say your city and dish out loud in the first three seconds of a short vertical clip",
    "Open the video on the finished plate, then show how it comes together",
    "Plant your flag on the channel your rivals are ignoring with one real clip from a normal shift",
    "Restart your quiet account with a short behind-the-counter clip this week",
    "Double down on the entree videos that are already outperforming for you",
  ])("allows a real play: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(false)
  })
})

// ── knowledge: budget + load-bearing sections ───────────────────────────────────
describe("knowledge — budget + the load-bearing sections", () => {
  it("stays well under the 40k-char prompt-budget cap", () => {
    expect(SOCIAL_COUNTER_KNOWLEDGE.length).toBeLessThan(25_000)
  })
  it("carries the named research decision trees and the boundary section", () => {
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("RANK BY ENGAGEMENT RATE")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("DIAGNOSE THE MECHANISM, NOT THE TOPIC")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("frequency-gap vs format-gap")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("WHITESPACE ECONOMICS")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("FOLKLORE FLAGS")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("CONTRAST PAIRS")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("CONFIDENCE CALIBRATION")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("SEGMENT AWARENESS")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("ENTITY-ATTRIBUTION HONESTY")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("WHAT YOU ARE NOT")
  })
  it("states the boundary from both sides (feed=content vs moves=campaign) and cedes the event series", () => {
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("the counter is CONTENT")
    expect(SOCIAL_COUNTER_KNOWLEDGE).toContain("events.competitor_")
  })
})

// ── parse: domain grounding, the kill-list, the stance backstop ──────────────────
describe("social-counter skill — parse + the >=1-cited-social-signal guardrail", () => {
  const rawPlay = (over: Record<string, unknown> = {}) => ({
    title: "Counter their winning Reel with the owner on camera",
    rationale: "A rival's Reels win on polish; counter with a person-and-motion clip they can't match.",
    recipe: [
      {
        channel: "a short vertical video (Reel)",
        platforms: ["Instagram"],
        audience: "the local audience the rival reaches",
        window: { note: "this week" },
        creativeDirection: "Film the owner plating one dish on your phone, in your own style.",
      },
    ],
    confidence: "directional",
    leverage: { label: "medium", basisInternal: "counter reach sized ordinally" },
    evidenceRefs: ["social.engagement_gap"],
    ...over,
  })

  it("coerces a model play grounded on a competitor social signal into a stamped @v2 play", () => {
    const plays = socialCounterSkill.parse([rawPlay()], competitiveWeekDossier)
    expect(plays).toHaveLength(1)
    expect(plays![0].skillId).toBe("social-counter")
    expect(plays![0].knowledgeVersion).toBe(KNOWLEDGE_VERSION)
  })
  it("keeps a play grounded on a v1-DROPPED competitor visual signal (the widened intake in action)", () => {
    const plays = socialCounterSkill.parse([rawPlay({ evidenceRefs: ["social.food_photography_gap"] })], competitiveWeekDossier)
    expect(plays).toHaveLength(1)
  })
  it("keeps a whitespace-grounded play (platform presence gap counts as a social signal)", () => {
    const plays = socialCounterSkill.parse([rawPlay({ evidenceRefs: ["social.platform_presence_gap"] })], competitiveWeekDossier)
    expect(plays).toHaveLength(1)
  })
  it("keeps an own-win-grounded play (own-format doubling is in-family)", () => {
    const plays = socialCounterSkill.parse([rawPlay({ evidenceRefs: ["social.top_performing_post"] })], competitiveWeekDossier)
    expect(plays).toHaveLength(1)
  })
  it("SUPPRESSES a play that cites NO social signal (e.g. only a menu ref) — no cited post, no counter-play", () => {
    const plays = socialCounterSkill.parse([rawPlay({ evidenceRefs: ["menu.signature_item_missing"] })], competitiveWeekDossier)
    expect(plays).toEqual([])
  })
  it("SUPPRESSES a play grounded only on a CEDED competitor-event ref", () => {
    const plays = socialCounterSkill.parse([rawPlay({ evidenceRefs: ["events.competitor_hosting_event"] })], competitiveWeekDossier)
    expect(plays).toEqual([])
  })
  it("SUPPRESSES a copy-their-post play even when grounded", () => {
    const plays = socialCounterSkill.parse(
      [rawPlay({ title: "Recreate the competitor's post with your own dishes" })],
      competitiveWeekDossier,
    )
    expect(plays).toEqual([])
  })
  it("SUPPRESSES an engagement-bait play even when grounded", () => {
    const plays = socialCounterSkill.parse(
      [rawPlay({ rationale: "Run a follow-for-follow campaign to close the gap." })],
      competitiveWeekDossier,
    )
    expect(plays).toEqual([])
  })
  it("SUPPRESSES a parroted canned rule recommendation even when grounded", () => {
    const plays = socialCounterSkill.parse(
      [rawPlay({ title: "Study what made this content perform well" })],
      competitiveWeekDossier,
    )
    expect(plays).toEqual([])
  })
  it("returns null on unparseable output so the deterministic fallback runs", () => {
    expect(socialCounterSkill.parse(42, competitiveWeekDossier)).toBeNull()
  })

  it("stance backstop: an unset stance becomes fix when a cited ref is warning-grade", () => {
    const d = withSignals([sig("social.engagement_gap", "Rival out-engages you", "warning")])
    const out = socialCounterSkill.parse([rawPlay({ stance: undefined })], d)
    expect(out![0].stance).toBe("fix")
  })
  it("stance backstop: an unset stance becomes capture on info-grade refs", () => {
    const d = withSignals([sig("social.viral_content", "Rival viral post", "info")])
    const out = socialCounterSkill.parse([rawPlay({ evidenceRefs: ["social.viral_content"], stance: undefined })], d)
    expect(out![0].stance).toBe("capture")
  })
  it("stance backstop resolves an evidence-key suffixed ref to its base rule", () => {
    const d = withSignals([sig("social.posting_frequency_gap", "Rival out-posts you", "critical")])
    const out = socialCounterSkill.parse(
      [rawPlay({ evidenceRefs: ["social.posting_frequency_gap:competitor"], stance: undefined })],
      d,
    )
    expect(out![0].stance).toBe("fix")
  })
  it("the model's deliberate stance is preserved (maintain stays maintain)", () => {
    const d = withSignals([sig("social.engagement_gap", "Rival out-engages you", "warning")])
    const out = socialCounterSkill.parse([rawPlay({ stance: "maintain" })], d)
    expect(out![0].stance).toBe("maintain")
  })
})

// ── fallback: SEVERITY-GATED counter vs whitespace vs zero-play (the v1 change) ──
describe("social-counter skill — severity-gated deterministic fallback", () => {
  it("a WARNING competitor signal yields a counter (attack-weakness) play, grounded on that signal", () => {
    const plays = socialCounterSkill.fallback(withSignals([sig("social.engagement_gap", "Rival out-engages you", "warning")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].skillId).toBe("social-counter")
    expect(plays[0].category).toBe("social")
    expect(plays[0].evidenceRefs).toEqual(["social.engagement_gap"])
    // counter, don't clone: the copy is about doing what the rival lacks, never "repost/copy them"
    expect(plays[0].rationale.toLowerCase()).toContain("don't copy")
  })
  it("an INFO competitor signal does NOT trigger the canned floor (the v1 severity change)", () => {
    // v1 fired its counter template off ANY competitor signal; v2 leaves the info-grade
    // opportunity to the model path where a bold counter can earn its framing.
    const plays = socialCounterSkill.fallback(withSignals([sig("social.content_type_opportunity", "Rival's entrees win", "info")]))
    expect(plays).toEqual([])
  })
  it("a WARNING whitespace signal yields an own-the-neglected-channel play", () => {
    const plays = socialCounterSkill.fallback(withSignals([sig("social.posting_frequency_low", "You post too little", "warning")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].evidenceRefs).toEqual(["social.posting_frequency_low"])
    expect(plays[0].title.toLowerCase()).toContain("flag")
  })
  it("a CRITICAL whitespace signal (dark account) yields a whitespace/restart play", () => {
    const plays = socialCounterSkill.fallback(withSignals([sig("social.inactive_account", "Your account is dark", "critical")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].evidenceRefs).toEqual(["social.inactive_account"])
  })
  it("an INFO whitespace signal does NOT trigger the floor", () => {
    const plays = socialCounterSkill.fallback(withSignals([sig("social.hashtag_gap", "Missing local tags", "info")]))
    expect(plays).toEqual([])
  })
  it("prefers the COMPETITOR signal when both an actionable competitor and whitespace signal are present", () => {
    const plays = socialCounterSkill.fallback(
      withSignals([
        sig("social.posting_frequency_low", "You post too little", "warning"),
        sig("social.engagement_gap", "Rival out-engages you", "warning"),
      ]),
    )
    expect(plays).toHaveLength(1)
    expect(plays[0].evidenceRefs).toEqual(["social.engagement_gap"]) // counter beats whitespace
  })
  it("an own-WIN signal never triggers the floor (doubling down is a model judgment)", () => {
    expect(socialCounterSkill.fallback(withSignals([sig("social.engagement_outperform", "You out-engage a rival", "info")]))).toEqual([])
  })
  it("emits NOTHING when no social signal is present (honesty / zero-play — kept from v1)", () => {
    expect(
      socialCounterSkill.fallback(withSignals([sig("menu.signature_item_missing"), sig("events.new_high_signal_event")])),
    ).toEqual([])
    expect(socialCounterSkill.fallback(withSignals([]))).toEqual([])
  })
  it("the kept fallback copy is SELF-CONSISTENT: it survives the skill's own kill-list + parse gates + voice lint", () => {
    const counter = socialCounterSkill.fallback(withSignals([sig("social.engagement_gap", "Rival out-engages you", "warning")]))
    const whitespace = socialCounterSkill.fallback(withSignals([sig("social.posting_frequency_low", "You post too little", "warning")]))
    for (const p of [...counter, ...whitespace]) {
      // survives the same gates parse() applies to the model
      expect(p.evidenceRefs.some(isSocialCounterSignal)).toBe(true)
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      expect(isTemplateAdvice(text)).toBe(false) // "don't copy their post" must NOT trip the copy-their-post pattern
      // number-free floor
      expect(/\d/.test(text)).toBe(false)
      // the floor ships no paste-anywhere customer copy
      expect(p.recipe.every((s) => s.copy === undefined)).toBe(true)
      expect(p.knowledgeVersion).toBe(KNOWLEDGE_VERSION)
      // brand voice: no em dashes, no kitchen lingo, anywhere in customer-facing text
      for (const s of [
        p.title,
        p.rationale,
        ...p.recipe.flatMap((r) => [r.audience, r.channel, r.window.note, r.creativeDirection ?? "", ...(r.dependencies ?? [])]),
      ]) {
        expect(lintVoice(s)).toEqual([])
      }
    }
  })
})

// ── hasCompetitorSocial: thin/absent rival social → whitespace path (KEPT) ───────
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
  it("with thin rival social but a warning whitespace signal, the end-to-end run yields a whitespace play", async () => {
    const failing: Transport = async () => {
      throw new Error("model down")
    }
    const d = withSignals([sig("social.inactive_account", "Your account is dark", "critical")])
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
    const d = withSignals([sig("social.engagement_gap", "Rival out-engages you", "warning")])
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
    const d = withSignals([sig("menu.signature_item_missing", "No signature dish")])
    const res = await runProducerSkill(socialCounterSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toEqual([])
  })
  it("competitive-week: the warning-grade posting_frequency_gap keeps the fallback firing (golden stays green)", async () => {
    // The competitive-week golden carries social.content_type_opportunity (info) +
    // social.posting_frequency_gap (warning). v1 fired off either; v2's severity gate
    // still fires off the warning one — so the skill still contributes to the golden brief.
    const res = await runProducerSkill(socialCounterSkill, competitiveWeekDossier, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toHaveLength(1)
    expect(res.plays[0].evidenceRefs).toEqual(["social.posting_frequency_gap"])
  })
})

// ── model-success path: a counter-play citing a real competitor post survives the run ──
describe("social-counter skill — model-success path with a cited competitor signal", () => {
  it("a model counter-play grounded on a v1-dropped competitor visual signal survives the ground-filter", async () => {
    const modelOutput: Transport = async () => [
      {
        title: "Answer their sharper food shots with the build, not a styled plate",
        rationale: "O-Ku's food photos out-score yours, but they only post finished plates; counter with the motion they never show.",
        recipe: [
          {
            channel: "a short vertical video (Reel)",
            platforms: ["Instagram"],
            audience: "the local audience O-Ku reaches",
            window: { note: "this week" },
            creativeDirection: "Film one dish coming together on your phone, the steam and the plating, in your own style.",
            copy: "Watch this come together.",
          },
        ],
        confidence: "medium",
        stance: "capture",
        leverage: { label: "high", basisInternal: "counters their polish with motion on the discovery channel" },
        evidenceRefs: ["social.food_photography_gap"],
      },
    ]
    const d: Dossier = {
      ...withSignals([sig("social.food_photography_gap", "O-Ku's food photos out-score yours", "warning")]),
      competitors: [competitorWithSocial("O-Ku", snapshot(8_000, [post("oku1", 400, { mediaType: "reel" })]))],
    }
    const res = await runProducerSkill(socialCounterSkill, d, { transport: modelOutput })
    expect(res.status).toBe("ok")
    expect(res.plays).toHaveLength(1)
    expect(res.plays[0].skillId).toBe("social-counter")
    expect(res.plays[0].evidenceRefs).toEqual(["social.food_photography_gap"])
  })
})
