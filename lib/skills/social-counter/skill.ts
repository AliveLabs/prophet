// ---------------------------------------------------------------------------
// Social Counter-Strategy skill — RETROFITTED (social-counter@v2, 2026-07-03),
// the sixth skill in the one-at-a-time mastery program. marketing@v2,
// reputation@v2, operations@v2, local-demand@v2 and positioning@v4 (all on main)
// are the proven templates.
//
// UNLIKE the five prior targets, this is a RETROFIT, not a rescue. v1 (P12) was
// already good, and its good bones KEEP their exact v1 form (see the keep-vs-
// change register in rationale.md):
//   - the COMPETITOR / WHITESPACE citable partition (a counter play cites a rival
//     move; a whitespace play cites an open lane);
//   - the play-shape mapping of the §3.1 sketch onto the real
//     EnrichedRecommendation (counterMove -> recipe fields; NO type change);
//   - the engagement-RATE-not-raw-likes doctrine, incl. the unrated-post rule
//     (postEngagementRate / rankPostsByRate — exported, unchanged);
//   - the per-competitor teardown built from the §4.4 structured vision tags;
//   - the specific human-and-motion counter fallback + the zero-play invariant
//     (no social signal -> no play).
//
// WHAT CHANGES is what the program pattern demands and what the generators prove.
//
// VERIFIED SIGNAL REALITY (read from lib/social/insights.ts +
// lib/social/visual-insights.ts and the pipeline that calls them,
// lib/jobs/pipelines/social.ts — NOT assumed from the type names). There are 44
// live social.* types; v1's two sets list only 14 of them, so 30 live social.*
// signals reached this skill and were DROPPED at intake (the prefix-gap pattern
// three of five prior siblings also carried). The full attribution table is in
// rationale.md; the load-bearing corrections:
//   - THE INTAKE INVERTS to a SINGLE broad social. prefix (mirrors marketing@v2's
//     isSocialProofSignal reading all of social.*), then the COMPETITOR/WHITESPACE
//     partition is applied ON TOP as reasoning routing, not as the intake gate —
//     so a rival's food_photography_gap / crowd_perception_gap / video_content_
//     opportunity / promo_blitz (all real competitor teardown material, all
//     dropped by v1) now ground a counter; a stalled own-format / inactive /
//     inconsistent signal grounds a whitespace-or-restart play.
//   - OWN-WIN signals (engagement_outperform, *_strong, *_win, *_excellent,
//     content_variety_good, visual_drives_engagement, top_performing_post) are
//     recognized as their OWN class: they are neither a rival to counter nor a gap
//     to fill. They ride as reasoning CONTEXT (they tell the model what already
//     works here, to borrow the operator's own proven format) and, per the
//     entity-attribution rule, may never be dressed up as a rival's move.
//   - social.cross_* (cross-signal.ts correlations) are DELIBERATELY LEFT to the
//     model as low-weight context only; they are corroboration-grade, never a
//     counter target and never a floor trigger (see WHAT YOU ARE NOT).
//   - visual.* (category_shift / professional_upgrade, from photo-insights.ts) is
//     NOT claimed: marketing@v2's isSocialProofSignal already reads visual.* as an
//     early-warning of a rival's visual upgrade. The social-counter read of the
//     SAME upgrade is a deliberate SHARED read named in the playbook, but the
//     citable ref stays marketing's; a social-counter play grounds on the social.*
//     teardown, not on visual.*.
//
// QUALITY MECHANISM (mirrors the five exemplars):
//  (1) parse() SUPPRESSES any play that doesn't ground on a social.* signal (run.ts
//      also ground-filters against allowedEvidenceRefs; this enforces the DOMAIN so
//      a play can't ride solely on a borrowed adjacent ref);
//  (2) a template kill-list drops the classes the founder mandate bans HERE — the
//      copy-their-post class, engagement-bait advice, buy-followers / engagement-pod
//      suggestions, generic "post more" (already dead at marketing, killed here too
//      so a borrowed marketing template can't sneak back in), AND the canned
//      recommendation strings the social/visual rules embed in their own rows
//      ("Study what made this content perform well", "Consider a counter-promotion",
//      "Analyze competitor's top-performing content", ...) so the model can never
//      parrot its own input;
//  (3) confidence is calibrated in the playbook, never hardcoded (menu-price
//      postmortem: hardcoded confidence is banned);
//  (4) stance is stamped DELIBERATELY per archetype in the playbook, and parse()
//      backstops an unset stance from the cited signals' severity (fix on
//      warning/critical, capture otherwise; maintain only ever model-chosen — a
//      counter-play is a move, not a habit).
//
// HONEST FLOOR (severity-gated — the v1 CHANGE): v1's fallback fired a canned
// counter play off ANY competitor signal at ANY severity, so competitive-week's
// info-grade social.content_type_opportunity alone manufactured a "beat their best
// post" card. v2 severity-gates the floor: the counter floor fires only on a
// warning/critical competitor social signal (competitive-week's warning-grade
// social.posting_frequency_gap still fires it — the golden stays green; its info
// content_type_opportunity no longer does). The whitespace floor fires only on a
// warning/critical own-gap. Info-grade competitor reads (viral_content,
// content_type_opportunity, ugc/video/seasonal/behind-scenes opportunities) are
// model-path material where a bold counter can EARN its framing; the canned floor,
// which can't read that nuance, stays silent. A quiet week stays an honest quiet
// brief. The v1 fallback COPY (person-and-motion counter; own-whitespace flag) is
// kept nearly verbatim — it survives the new kill-list (self-consistency tested).
//
// TOKEN BUDGET: v1 already trimmed the teardown (TOP_POSTS_PER_COMPETITOR + a
// per-post distillation); v2 holds that discipline and hard-caps the widened rule-
// output intake per class (guerrilla precedent: a ~40k-char prompt at medium effort
// silently timed out into the fallback). Effort stays default (medium); if p95
// nears the 120s abort, flip effort: "low" (the proven lever).
// ---------------------------------------------------------------------------

import type { Dossier, EntitySignals } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { NormalizedSocialPost, SocialSnapshotData } from "@/lib/social/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { SOCIAL_COUNTER_KNOWLEDGE } from "@/lib/skills/social-counter/knowledge"

// VERSION: social-counter@v1 is the ONLY prior string (verified across git history
// for this skill — no @v2/@v3 was ever persisted, unlike positioning which had a
// P4-era @v2 collision). So the plain program bump to @v2 is safe: the feedback
// rollup keys on knowledgeVersion and this keeps the history monotonic.
const KNOWLEDGE_VERSION = "social-counter@v2"

// ── The social-counter archetypes (stable keys — the click-feedback sub-domain the
//    rollup can learn by, mirroring the exemplars' *_ARCHETYPES exports). These name
//    the counter/whitespace/teardown/borrow space the playbook designs. ──
export const SOCIAL_COUNTER_ARCHETYPES = [
  "attack_the_gloss", // counter a faceless/over-polished rival with a person + motion
  "borrow_the_proven_format", // appropriate the winning MECHANIC (format/hook), never the post
  "counter_program_the_blitz", // a rival floods promos/a gimmick -> post calm quality, don't join
  "beat_the_hook", // teardown says the win is a hook/first-frame mechanic -> out-hook it
  "plant_the_flag", // a platform/format the rivals ceded -> own it first (verified-audience-gated)
  "restart_the_dark_channel", // our own account is dark/erratic -> the honest restart, not "post more"
  "own_format_doubling", // an own-WIN format is proven -> double down on what already works here
] as const
export type SocialCounterArchetype = (typeof SOCIAL_COUNTER_ARCHETYPES)[number]

// ── Intake: the SINGLE broad social. prefix (the v2 inversion) ────────────────
// v1 gated intake on two hand-listed 8-and-6-type sets, which silently dropped 30
// live social.* types. v2 reads ALL social.* (lockstep with marketing@v2's
// isSocialProofSignal), then routes each within the family. The parse() gate uses
// this same predicate, so intake and grounding stay in lockstep.
export function isSocialCounterSignal(t: string): boolean {
  return t.startsWith("social.")
}

// ── Reasoning ROUTING inside the family (KEPT from v1, widened) ────────────────
// The COMPETITOR / WHITESPACE partition is v1's, preserved as the routing that
// tells the model which signals it may COUNTER vs which name an open lane to OWN.
// v2 widens both sets to the full generator reality (see the attribution table in
// rationale.md) and adds a third class v1 conflated away: OWN-WINS.
//
// COMPETITOR = a real rival move we can counter (a cited competitor post/gap/blitz).
const COMPETITOR_SOCIAL_TYPES = new Set([
  // behavioral (lib/social/insights.ts)
  "social.engagement_gap", // a rival out-engages us — the prime counter target (warning)
  "social.viral_content", // a rival's viral post — cited post anatomy (info)
  "social.content_type_opportunity", // a rival's winning FORMAT (info)
  "social.competitor_promo_blitz", // a rival flooding promos — counter-program (warning)
  "social.promotional_activity", // a rival running promos (warning)
  "social.follower_growth_gap", // a rival growing faster (warning)
  "social.posting_frequency_gap", // a rival out-posting us (warning/critical)
  "social.hashtag_gap", // discovery tags a rival uses, we don't (info)
  // visual (lib/social/visual-insights.ts) — the teardown material v1 DROPPED
  "social.visual_quality_gap", // a rival's photos are sharper (warning)
  "social.food_photography_gap", // a rival's food shots look better (warning)
  "social.professional_content_gap", // a rival posts more polished content (warning)
  "social.crowd_perception_gap", // a rival LOOKS busier (warning)
  "social.ugc_dominance", // a rival features more customer content (info)
  "social.video_content_opportunity", // a rival's video is winning the format war (info)
  "social.seasonal_content_gap", // a rival rides seasonal moments we skip (info)
  "social.behind_scenes_opportunity", // a rival's BTS content lands (info)
])

// WHITESPACE = a neglected channel/format to OWN, or our own account to restart,
// when there's no rival post worth countering.
const WHITESPACE_SOCIAL_TYPES = new Set([
  "social.platform_presence_gap", // rivals on a platform we've ceded — plant the flag (critical)
  "social.inactive_account", // our own account is dark — restart it (critical)
  "social.engagement_below_average", // our content isn't landing — change the format (warning)
  "social.posting_frequency_low", // we post too little (warning)
  "social.posting_inconsistent", // our cadence is erratic (warning)
  "social.content_mix_imbalance", // our feed is one-note next to a diversified rival (warning)
  "social.content_variety_low", // our feed is one-note (self-assessed) (warning)
  "social.brand_consistency_low", // our look is scattered (warning)
  "social.visual_quality_needs_work", // our photos are weak (warning)
  "social.food_photography_weak", // our food shots are weak (warning)
])

// OWN-WINS = neither a rival to counter nor a gap to fill: a format that is ALREADY
// working for THIS operator. Grounds an own-format-doubling play; per the entity-
// attribution rule these may NEVER be reframed as a rival's move.
const OWN_WIN_SOCIAL_TYPES = new Set([
  "social.engagement_outperform",
  "social.engagement_excellent",
  "social.posting_frequency_strong",
  "social.content_type_self_analysis", // our own format read — an own-win lever
  "social.top_performing_post",
  "social.visual_quality_win",
  "social.visual_quality_strong",
  "social.food_photography_strong",
  "social.content_variety_good",
  "social.visual_drives_engagement",
])

function isCompetitorSocialSignal(t: string): boolean {
  return COMPETITOR_SOCIAL_TYPES.has(t)
}
function isWhitespaceSocialSignal(t: string): boolean {
  return WHITESPACE_SOCIAL_TYPES.has(t)
}
function isOwnWinSocialSignal(t: string): boolean {
  return OWN_WIN_SOCIAL_TYPES.has(t)
}

// ── Template kill-list (the analogue of the exemplars' TEMPLATE_PENALTY_PATTERNS).
//    The founder mandate bans, HERE:
//    (1) the COPY-THEIR-POST class — a counter must be the operator's own move,
//        never a repost/clone/recreate of the rival's exact post or caption;
//    (2) ENGAGEMENT-BAIT advice (follow-for-follow, like/comment-for-a-chance,
//        "tag 3 friends", giveaways-for-follows) — cheap, brand-cheapening, and it
//        buys vanity numbers the cardinal RATE rule exists to discount;
//    (3) BUY-FOLLOWERS / ENGAGEMENT-POD / bot suggestions — never;
//    (4) generic "post more"/"be more active" (already dead at marketing; killed
//        here so a borrowed marketing-shaped template can't slip back in);
//    (5) the canned recommendation strings the social + visual rules embed in their
//        OWN rows, which the model reads in its input and must never parrot
//        (verified literals in lib/social/insights.ts + visual-insights.ts).
//    v1 shipped NO floor titles that need killing (its floor copy is descriptive,
//    not a template phrase), so unlike positioning there are no v1 titles to kill —
//    but the kept v1 fallback copy is self-consistency-tested against this list. ──
const TEMPLATE_PENALTY_PATTERNS = [
  // (1) copy-their-post class. The verb-noun pair allows up to ~3 adjective words
  // between the possessive/demonstrative and the media noun ("their winning Reel",
  // "that viral video"). A negative lookbehind spares the LEGITIMATE anti-cloning
  // instruction the playbook + the kept fallback use ("don't copy their post",
  // "instead of reposting their video") — only the imperative-to-copy is banned.
  /(?<!\b(?:don'?t|do not|never|avoid|without|instead of|rather than|not|no)\s(?:\w+\s){0,3})\b(?:copy|clone|recreate|replicate|repost|reproduce|duplicate|mimic|imitate|remake)\s(?:their|the (?:competitor'?s?|rival'?s?)|that)\s(?:\w+\s){0,3}(?:post|posts|reel|reels|video|videos|content|caption|captions|clip|clips)\b/i,
  /\bpost the same (?:\w+\s){0,2}(?:thing|content|video|reel|post)\b/i,
  /\bdo (?:the )?exact(?:ly)? (?:the )?same (?:post|thing|video)\b/i,
  /\buse (?:their|the same) caption\b/i,
  // (2) engagement-bait
  /\bengagement bait\b/i,
  /\bfollow[- ]?for[- ]?follow\b/i,
  /\bf4f\b/i,
  /\blike[- ]?for[- ]?like\b/i,
  /\bcomment[- ]?for[- ]?(?:a )?(?:chance|entry|follow)\b/i,
  /\btag (?:\d+|three|two|your) friends?\b/i,
  /\b(?:run|host|do) a giveaway (?:to|for) (?:gain|get|grow|boost) (?:followers|reach|engagement)\b/i,
  /\bgiveaway for follows?\b/i,
  // (3) buy / pod / bots
  /\bbuy (?:followers|likes|views|engagement)\b/i,
  /\bengagement pod\b/i,
  /\b(?:use|buy) bots?\b/i,
  /\bpurchase (?:followers|likes|engagement)\b/i,
  // (4) generic post-more (marketing's dead class, killed here too)
  /\bpost more\b/i,
  /\bpost (?:more )?(?:consistently|regularly|frequently)\b/i,
  /\bbe (?:more )?active on social\b/i,
  /\bboost your (?:online|social media) presence\b/i,
  /\bleverage social media\b/i,
  // (5) canned rule-row recommendation strings the model must never parrot
  /\bstudy what made this content perform well\b/i, // viral_content rule's canned rec
  /\banalyze competitor'?s? top-performing content\b/i, // engagement_gap rule's canned rec
  /\breview competitor'?s? recent content and campaigns\b/i, // follower_growth_gap rule's canned rec
  /\bconsider a counter-promotion\b/i, // promotional_activity + promo_blitz rules' canned rec
  /\bcounter-promotion or (?:loyalty offer|unique value offer)\b/i, // same rows
  /\breplicate the format and style of your top-performing post\b/i, // top_performing_post rule's canned rec
  /\bschedule posts in advance\b/i, // posting_inconsistent rule's canned rec
  /\binvest in better photography\b/i, // visual_quality_gap rule's canned rec
  /\bimprove food styling and photography\b/i, // food_photography_gap rule's canned rec
  /\bschedule regular professional photo sessions\b/i, // professional_content_gap rule's canned rec
  /\bcreate visual brand guidelines\b/i, // brand_consistency_low rule's canned rec
  /\bencourage and repost customer content\b/i, // ugc_dominance rule's canned rec
  /\bcreate seasonal and holiday-themed content\b/i, // seasonal_content_gap rule's canned rec
]

/** True when a play's user-facing text reads as a banned class (copy-their-post,
 *  engagement-bait, buy/pod, generic post-more) or a parroted canned rule rec. */
export function isTemplateAdvice(text: string): boolean {
  return TEMPLATE_PENALTY_PATTERNS.some((re) => re.test(text))
}

// ── Engagement-RATE ranking (the cardinal rule) — KEPT VERBATIM from v1 ────────
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
// KEPT from v1: for each competitor with a social sub-dossier, surface the TOP posts
// by engagement RATE plus their structured visual tags (the post-anatomy teardown).
// The model reads this to cluster the winning pattern; it grounds the PLAY on the
// social.* rule outputs.

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
 *  down). When false, only whitespace/own plays are appropriate (degrade to "own the neglected
 *  channel"). KEPT from v1. */
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

/** Capped, filtered slice of grounded rule outputs (token-budget discipline — the
 *  intake widened to all social.*, so the cap matters more than in v1). */
function take(d: Dossier, pred: (t: string) => boolean, cap: number) {
  return d.ruleOutputs.filter((i) => pred(i.insight_type)).slice(0, cap)
}

function selectInput(d: Dossier) {
  return {
    // The CITABLE social signals, PARTITIONED so the model knows which it may counter,
    // which name an open lane to own, and which are the operator's OWN proven wins
    // (context to borrow, never to reframe as a rival's move). Each capped.
    competitorSocialSignals: take(d, isCompetitorSocialSignal, 8),
    whitespaceSignals: take(d, isWhitespaceSocialSignal, 6),
    ownWinSignals: take(d, isOwnWinSocialSignal, 4),
    // Per-competitor teardown CONTEXT: top posts by engagement RATE + their visual anatomy.
    competitorTeardowns: d.competitors.map(competitorTeardown).filter(Boolean),
    // The operator's own social posture (whitespace + fit context — not a rival to counter).
    ownSocial: ownSocialSummary(d),
    // When false, the strategist degrades to own-whitespace plays (no rival post worth countering).
    hasCompetitorSocialToCounter: isCompetitorSignalPresent(d),
    liveChannels: d.profile.capability.liveChannels ?? [],
    // Segment read (drives which archetypes fit + verified-audience gating for whitespace —
    // see SEGMENT AWARENESS + the whitespace economics doctrine in the playbook).
    segment: {
      tier: d.tier.tier,
      maxLocations: d.tier.maxLocations,
      seats: d.profile.capability.seats ?? null,
      serviceModel: d.profile.attributes.serviceModel ?? null,
      ownSocialPlatforms: d.tier.ownSocialPlatforms,
    },
  }
}

/** A competitor social SIGNAL is present (a rival move worth countering) when there's both a usable
 *  competitor social sub-dossier AND at least one cited competitor social rule output. KEPT from v1. */
function isCompetitorSignalPresent(d: Dossier): boolean {
  return hasCompetitorSocial(d) && d.ruleOutputs.some((i) => isCompetitorSocialSignal(i.insight_type))
}

// ── Parse: shared coercion + the social-counter quality gates ──────────────────
//  (1) every play grounds on >= 1 social.* signal (run.ts also ground-filters
//      against allowedEvidenceRefs; this enforces the DOMAIN so a play can't ride
//      solely on a borrowed adjacent ref);
//  (2) the banned classes (copy-their-post, engagement-bait, buy/pod, post-more)
//      and parroted canned recs are SUPPRESSED (the kill-list above);
//  (3) stance backstop: keep the model's deliberate stance; when unset, stamp "fix"
//      if any cited social ref resolves to a warning/critical rule output, else
//      "capture". "maintain" is only ever model-chosen (scoring caps its impact —
//      a counter-play is a move, not a habit).
function parse(raw: unknown, d: Dossier): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "social-counter",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "capitalize",
    defaultOwner: "marketing",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  const severityByType = new Map(d.ruleOutputs.map((i) => [i.insight_type, i.severity] as const))
  return coerced
    .filter((p) => {
      if (!p.evidenceRefs.some(isSocialCounterSignal)) return false // (1) domain grounding
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      if (isTemplateAdvice(text)) return false // (2) kill the banned classes
      return true
    })
    .map((p) => {
      if (p.stance) return p // the model's deliberate stance wins
      const citesFailure = p.evidenceRefs.some((r) => {
        const sev = severityByType.get(r.split(":")[0])
        return sev === "warning" || sev === "critical"
      })
      return { ...p, stance: citesFailure ? ("fix" as const) : ("capture" as const) } // (3)
    })
}

// ── Deterministic, grounded, NUMBER-FREE fallback ─────────────────────────────
//
// v1 emitted a counter/whitespace play off ANY matching signal at ANY severity.
// v2 severity-gates it (the exemplar pattern): at most ONE play, in priority order.
//  (a) a warning/critical COMPETITOR social signal -> the attack-weakness counter
//      (put a person / the owner / motion on camera — what a glossy rival lacks).
//      competitive-week's warning-grade social.posting_frequency_gap keeps this
//      firing; its info-grade content_type_opportunity no longer manufactures one.
//  (b) else a warning/critical WHITESPACE signal -> the own-the-neglected-channel
//      / honest-restart play.
// Info-grade competitor reads (viral_content, content_type_opportunity, ugc/video/
// seasonal/BTS opportunities) never trigger the canned floor — the model path earns
// those framings. Own-win signals never trigger the floor (doubling down on a
// proven format is a model judgment). No social signal at all -> nothing (the v1
// zero-play honesty invariant). The COPY is kept nearly verbatim from v1 and is
// self-consistency-tested against the kill-list.
function fallback(d: Dossier): EnrichedRecommendation[] {
  const actionable = (sev: string) => sev === "warning" || sev === "critical"
  const competitor = d.ruleOutputs.find((i) => isCompetitorSocialSignal(i.insight_type) && actionable(i.severity))
  const whitespace = d.ruleOutputs.find((i) => isWhitespaceSocialSignal(i.insight_type) && actionable(i.severity))
  const grounding = competitor ?? whitespace
  if (!grounding) return [] // no actionable social signal -> produce nothing (honesty / zero-play)

  const isCounter = !!competitor
  const ins = grounding

  if (isCounter) {
    return [
      {
        title: "Beat your rival's best post with one the owner is in",
        rationale: `Grounded in ${ins.title}. A nearby competitor is winning on social. Don't copy their post. Counter it with the thing a glossy rival feed usually lacks: a real person and real motion from your kitchen.`,
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
  // effort left at the default (medium): v1's teardown was already trimmed and the
  // widened rule-output intake is hard-capped per class, so the prompt stays well
  // under the ~40k-char size that forced guerrilla to "low". WATCH ITEM: if p95
  // nears the 120s abort, flip to effort: "low" (the proven lever) rather than
  // letting the skill silently degrade to the fallback.
  //
  // temperature stays at v1's 0.6 ON PURPOSE (marketing's setting, not operations'
  // 0.4): counter-content is a creative act — the boldness comes from the playbook,
  // and the RATE cardinal rule + grounding gate keep the heat honest.
  temperature: 0.6,
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: SOCIAL_COUNTER_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(socialCounterSkill, d, selectInput(d), k),
  parse,
  fallback,
  // P14 learning hook: social counter-strategy has a clear external benchmark stream
  // (Rival IQ / Socialinsider F&B benchmarks -> external_trend priors). Click feedback
  // is now learnable per-archetype via SOCIAL_COUNTER_ARCHETYPES keys; ask routing for
  // social/posting/competitor questions. Opt-in metadata; injection gated to ACTIVE rows.
  learning: {
    streams: ["external", "click", "ask"],
    playTypeLeadDomain: "social",
    acceptedLearningKinds: ["external_trend", "editorial"],
  },
}

// Re-exported for the skill's own guardrail check + tests.
export { isCompetitorSocialSignal, isWhitespaceSocialSignal, isOwnWinSocialSignal }
