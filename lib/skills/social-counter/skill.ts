// ---------------------------------------------------------------------------
// Social Counter-Strategy skill (P12 expert roster) — the competitive social
// strategist. Reads a rival's winning posts, diagnoses WHY they work, and hands
// the owner ONE phone-shootable counter-play that beats it on their own audience.
//
// Its OWN category "social" (neutral 1.0 prior), split from the Marketing skill
// (which owns the operator's own content cadence/mix) so the operator sees a
// distinct competitive-social lens and the per-operator rerank (P8) can weight it
// independently — and so its click lead-domain is `social` for the P14 learning
// loop. Runs on the standard reasoning tier (NOT the Opus deep pass).
//
// GROUNDING REALITY: the only CITABLE evidence is the dossier's social.* rule
// outputs (the closed allowedEvidenceRefs set; run.ts drops any play that cites
// anything else). The competitors' raw social/visual sub-dossiers are passed as
// reasoning CONTEXT (rank by engagement RATE, read the post anatomy, cluster the
// winning pattern) — a raw competitor like-count is NOT a citable figure. So every
// play must rest on a real social.* signal or it does not fire.
//
// PLAY SHAPE: the §3.1 sketch's {competitorEvidence, counterMove, ...} is mapped
// onto the real EnrichedRecommendation (we do NOT change that type):
//   - competitorEvidence  -> evidenceRefs (the cited social.* rule outputs)
//   - counterMove.type     -> a "Counter-move:" prefix on recipe.creativeDirection
//   - counterMove.format   -> recipe.channel + recipe.platforms (Reel / carousel / ...)
//   - counterMove.hook     -> recipe.copy (customer-facing, the restaurant's voice)
//   - counterMove.shotList -> recipe.creativeDirection (phone-first, plain words)
//   - suggestedPostTime    -> recipe.window.note
//   - trendingSound        -> an optional line in recipe.creativeDirection
// This keeps the output flowing through the P11 presenter + checks unchanged.
// ---------------------------------------------------------------------------

import type { Dossier, EntitySignals } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { NormalizedSocialPost, SocialSnapshotData } from "@/lib/social/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { SOCIAL_COUNTER_KNOWLEDGE } from "@/lib/skills/social-counter/knowledge"

const KNOWLEDGE_VERSION = "social-counter@v1"

// ── Citable social signals, partitioned by what they let the strategist do ────
//
// COMPETITOR signals = a real rival move we can COUNTER (a cited competitor post /
// gap / blitz). A play that counters a rival MUST cite one of these.
const COMPETITOR_SOCIAL_TYPES = new Set([
  "social.engagement_gap", // a rival out-engages us — the prime counter target
  "social.viral_content", // a rival's viral post — cited post anatomy
  "social.content_type_opportunity", // a rival's winning FORMAT
  "social.competitor_promo_blitz", // a rival flooding promos — counter-program
  "social.promotional_activity", // a rival running promos
  "social.follower_growth_gap", // a rival growing faster
  "social.posting_frequency_gap", // a rival out-posting us
  "social.hashtag_gap", // discovery tags a rival uses, we don't
])

// WHITESPACE signals = a neglected channel/format to OWN when rival social is thin
// (no rival post worth countering). A whitespace play MUST cite one of these.
const WHITESPACE_SOCIAL_TYPES = new Set([
  "social.platform_presence_gap", // rivals on a platform we've ceded — plant the flag
  "social.inactive_account", // our own account is dark — restart it
  "social.engagement_below_average", // our content isn't landing — change the format
  "social.posting_frequency_low", // we post too little
  "social.posting_inconsistent", // our cadence is erratic
  "social.video_content_opportunity", // a format nobody local is using
])

function isCompetitorSocialSignal(t: string): boolean {
  return COMPETITOR_SOCIAL_TYPES.has(t)
}
function isWhitespaceSocialSignal(t: string): boolean {
  return WHITESPACE_SOCIAL_TYPES.has(t)
}
function isSocialCounterSignal(t: string): boolean {
  return isCompetitorSocialSignal(t) || isWhitespaceSocialSignal(t)
}

// ── Engagement-RATE ranking (the cardinal rule) ───────────────────────────────
//
// Rank by engagement RATE = engagement / audience, never by raw likes. We divide by
// reach/views where a view count exists, else by follower count — so a big account's
// vanity numbers never win. Posts with no audience denominator fall back to raw
// engagement only as a last resort (and sort below any rate-scored post).

function postEngagement(p: NormalizedSocialPost): number {
  // saves aren't a discrete field on NormalizedSocialPost; sum the discrete signals we have.
  return p.likesCount + p.commentsCount + p.sharesCount
}

/** Engagement RATE for one post. Prefer ÷ views/reach (best available proxy for who SAW it),
 *  else ÷ followers. Returns null when neither denominator is usable — such a post can't be
 *  rate-ranked and must never be treated as a winner on raw likes alone. */
export function postEngagementRate(p: NormalizedSocialPost, followerCount: number): number | null {
  const eng = postEngagement(p)
  if (p.viewsCount && p.viewsCount > 0) return eng / p.viewsCount
  if (followerCount > 0) return eng / followerCount
  return null
}

type RankedPost = {
  post: NormalizedSocialPost
  rate: number | null
  engagement: number
}

/** Rank a competitor's posts by engagement RATE (NOT raw likes), best first. Rate-scored posts
 *  always sort above any post we could only score on raw engagement. */
export function rankPostsByRate(snap: SocialSnapshotData): RankedPost[] {
  const followers = snap.profile.followerCount
  return snap.recentPosts
    .map((post) => ({ post, rate: postEngagementRate(post, followers), engagement: postEngagement(post) }))
    .sort((a, b) => {
      if (a.rate !== null && b.rate !== null) return b.rate - a.rate
      if (a.rate !== null) return -1
      if (b.rate !== null) return 1
      return b.engagement - a.engagement // last resort, both unrated
    })
}

// ── Competitor teardown context (NOT citable evidence — reasoning material) ────
//
// For each competitor with a social sub-dossier, surface the TOP posts by engagement
// RATE plus their structured visual tags (the post-anatomy teardown). The model reads
// this to cluster the winning pattern; it grounds the PLAY on the social.* rule outputs.

const TOP_POSTS_PER_COMPETITOR = 4

function teardownPost(rp: RankedPost) {
  const p = rp.post
  const v = p.visualAnalysis
  return {
    format: p.mediaType,
    engagementRatePct: rp.rate !== null ? Math.round(rp.rate * 1000) / 10 : null, // 1 d.p. %, null if unrated
    caption: p.text ? p.text.slice(0, 140) : null,
    hashtags: p.hashtags.slice(0, 6),
    postedAt: p.createdTime,
    // The EXISTING structured visual tags = the post anatomy (the vision tagger is already structured).
    anatomy: v
      ? {
          contentCategory: v.contentCategory,
          subcategory: v.subcategory || undefined,
          plating: v.foodPresentation.platingQuality,
          lighting: v.visualQuality.lighting,
          editing: v.visualQuality.editing,
          energy: v.atmosphereSignals.energy,
          crowd: v.atmosphereSignals.crowdLevel,
          promotional: v.promotionalContent || undefined,
          // §4.4 additive post-anatomy fields (optional — undefined on legacy analyses, back-compat).
          peoplePresent: v.peoplePresent,
          ownerOrStaffPresent: v.ownerOrStaffPresent,
          steamOrMotion: v.steamOrMotion,
          trendingSound: v.trendingSound,
          firstFrame: v.firstFrame || undefined,
        }
      : null,
  }
}

function competitorTeardown(c: EntitySignals) {
  if (!c.social) return null
  const ranked = rankPostsByRate(c.social).slice(0, TOP_POSTS_PER_COMPETITOR)
  if (ranked.length === 0) return null
  return {
    competitor: c.name,
    platform: c.social.profile.platform,
    followerCount: c.social.profile.followerCount,
    // engagementRate is a per-post rate; phrased conditionally in the knowledge prose.
    accountEngagementRatePct: c.social.aggregateMetrics.engagementRate,
    postingPerWeek: c.social.aggregateMetrics.postingFrequencyPerWeek,
    topPostsByRate: ranked.map(teardownPost),
  }
}

/** True when the dossier carries ANY usable competitor social sub-dossier (a post worth tearing
 *  down). When false, only whitespace plays are appropriate (degrade to "own the neglected channel"). */
export function hasCompetitorSocial(d: Dossier): boolean {
  return d.competitors.some((c) => !!c.social && c.social.recentPosts.length > 0)
}

function ownSocialSummary(d: Dossier) {
  const s = d.location.social
  if (!s) return null
  const m = s.aggregateMetrics
  return {
    platform: s.profile.platform,
    followerCount: s.profile.followerCount,
    accountEngagementRatePct: m.engagementRate, // per-post rate, conditional
    postingPerWeek: m.postingFrequencyPerWeek,
    postingWindowDays: m.postingWindowDays ?? null,
    lastPostAt: m.lastPostAt ?? null,
    topHashtags: m.topHashtags.slice(0, 6),
  }
}

function selectInput(d: Dossier) {
  const competitorSocial = isCompetitorSignalPresent(d)
  return {
    // The CITABLE social signals, partitioned so the model knows which it may counter vs own.
    competitorSocialSignals: d.ruleOutputs.filter((i) => isCompetitorSocialSignal(i.insight_type)),
    whitespaceSignals: d.ruleOutputs.filter((i) => isWhitespaceSocialSignal(i.insight_type)),
    // Per-competitor teardown CONTEXT: top posts by engagement RATE + their visual anatomy.
    competitorTeardowns: d.competitors.map(competitorTeardown).filter(Boolean),
    // The operator's own social posture (whitespace + fit context — not a rival to counter).
    ownSocial: ownSocialSummary(d),
    // When false, the strategist degrades to own-whitespace plays (no rival post worth countering).
    hasCompetitorSocialToCounter: competitorSocial,
    liveChannels: d.profile.capability.liveChannels ?? [],
    serviceModel: d.profile.attributes.serviceModel ?? null,
  }
}

/** A competitor social SIGNAL is present (a rival move worth countering) when there's both a usable
 *  competitor social sub-dossier AND at least one cited competitor social rule output. */
function isCompetitorSignalPresent(d: Dossier): boolean {
  return hasCompetitorSocial(d) && d.ruleOutputs.some((i) => isCompetitorSocialSignal(i.insight_type))
}

// ── Parse: standard coercion + the social guardrails ──────────────────────────
//
// On top of the shared coercion, enforce: every play cites >= 1 SOCIAL counter signal
// (competitor OR whitespace) — a play that cites only non-social refs is SUPPRESSED.
// (run.ts additionally ground-filters against the closed allowedEvidenceRefs set, so a
// hallucinated ref is dropped there; here we enforce the DOMAIN: a social-counter play
// must rest on a real social signal, not borrow another skill's ref.)
function parse(raw: unknown, _d: Dossier): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "social-counter",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "capitalize",
    defaultOwner: "marketing",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  // ≥1-cited-social-signal-or-SUPPRESS: drop any play that doesn't rest on a social.* signal.
  return coerced.filter((p) => p.evidenceRefs.some(isSocialCounterSignal))
}

// ── Deterministic, grounded, NUMBER-FREE fallback ─────────────────────────────
//
// When the model is unavailable, emit a counter/whitespace play ONLY when a social
// counter signal exists to ground it; otherwise NOTHING (no signal, no play). Branches:
//  - a COMPETITOR signal present -> a "study and counter their winning post" play
//    (attack-weakness framing: put a person / the owner / motion on camera).
//  - only a WHITESPACE signal     -> an "own the neglected channel" play.
// Never fabricates a follower count, view count, engagement rate, or any number.
function fallback(d: Dossier): EnrichedRecommendation[] {
  const competitor = d.ruleOutputs.find((i) => isCompetitorSocialSignal(i.insight_type))
  const whitespace = d.ruleOutputs.find((i) => isWhitespaceSocialSignal(i.insight_type))
  const grounding = competitor ?? whitespace
  if (!grounding) return [] // no social signal at all -> produce nothing (honesty / zero-play)

  const isCounter = !!competitor
  const ins = grounding

  if (isCounter) {
    return [
      {
        title: "Beat your rival's best post with one the owner is in",
        rationale: `Grounded in ${ins.title}. A nearby competitor is winning on social. Don't copy their post — counter it with the thing a glossy rival feed usually lacks: a real person and real motion from your kitchen.`,
        skillId: "social-counter",
        ownerRole: "marketing" as const,
        kind: "capitalize" as const,
        category: "social" as const,
        stance: "capture" as const,
        recipe: [
          {
            channel: "a short vertical video (Reel / TikTok) on your live channels",
            platforms: [],
            audience: "the local audience your rival is reaching",
            window: { note: "this week, while it's top of mind" },
            creativeDirection:
              "Counter-move: do what their polished feed doesn't. On your phone, film a short clip of you or someone on your team making or handing over one dish, so people see the human and the food being made, not just a styled plate.",
            dependencies: ["a phone", "about fifteen minutes during a normal shift"],
          },
        ],
        confidence: "directional" as const,
        leverage: {
          label: "medium" as const,
          basisInternal: "counter-play reach sized ordinally; no engagement figure available in the fallback path",
        },
        evidenceRefs: [ins.insight_type],
        knowledgeVersion: KNOWLEDGE_VERSION,
      },
    ]
  }

  return [
    {
      title: "Plant your flag on the channel your rivals are ignoring",
      rationale: `Grounded in ${ins.title}. There isn't a strong rival post to counter right now, so take the open lane: show up where the competition is thin, on your own terms.`,
      skillId: "social-counter",
      ownerRole: "marketing" as const,
      kind: "capitalize" as const,
      category: "social" as const,
      stance: "capture" as const,
      recipe: [
        {
          channel: "the neglected channel from the signal",
          platforms: [],
          audience: "local customers who discover places on this channel",
          window: { note: "start this week and keep a steady rhythm" },
          creativeDirection:
            "Own-whitespace: post one simple, real clip or photo from a normal shift to claim the space first. Keep it easy enough that you can repeat it without a crew.",
          dependencies: ["a phone", "a few minutes during service"],
        },
      ],
      confidence: "directional" as const,
      leverage: {
        label: "medium" as const,
        basisInternal: "whitespace play sized ordinally; no audience figure available in the fallback path",
      },
      evidenceRefs: [ins.insight_type],
      knowledgeVersion: KNOWLEDGE_VERSION,
    },
  ]
}

export const socialCounterSkill: ProducerSkill = {
  id: "social-counter",
  displayName: "Social counter-strategy expert",
  ownerRole: "marketing",
  kind: "capitalize",
  category: "social",
  tier: "reasoning",
  temperature: 0.6,
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: SOCIAL_COUNTER_KNOWLEDGE,
  buildPrompt: (d) => buildSkillPrompt(socialCounterSkill, d, selectInput(d)),
  parse,
  fallback,
}

// Re-exported for the skill's own guardrail check + tests.
export { isSocialCounterSignal, isCompetitorSocialSignal, isWhitespaceSocialSignal }
