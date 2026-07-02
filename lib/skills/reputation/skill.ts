// ---------------------------------------------------------------------------
// Reputation / Reviews skill — REWRITTEN (reputation@v2, 2026-07-02) from a thin
// "review themes + reply strategy + review-velocity asks" advisor into the
// FIX-SIDE and INTELLIGENCE master for reviews. Second skill in the one-at-a-time
// mastery program; marketing@v2 (lib/skills/marketing/skill.ts) is the template.
//
// WHY: v1's whole playbook was 23 lines; its fallback shipped the literal template
// "Act on what your reviews are telling you" with a canned copy-paste reply draft
// (the exact response pattern the research says BACKFIRES), and its "ask-for-reviews
// routine" overlapped the lane marketing@v2 now owns. v2 splits the domain cleanly:
//  - marketing OWNS review EARNING (the steady post-visit drip, REVIEW_ENGINE) and
//    putting praise to work in campaigns (SIGNATURE_ITEM_CAMPAIGN). CEDED here.
//  - reputation OWNS (a) response craft + the service-recovery arc, (b) complaint
//    theme -> prioritized FIX plays with the operational cause named (operations
//    adjacency), (c) rating/velocity intelligence: display-threshold proximity,
//    honest repair arithmetic as URGENCY framing (the earn-side execution is handed
//    to marketing), (d) competitor review mining: their recurring complaint = a
//    conquest opening (intel; positioning/marketing execute), their wobble = a
//    timing signal, (e) legitimate dispute/removal, never gaming.
//
// QUALITY MECHANISM (mirrors marketing@v2, the proven pattern):
//  (1) parse() SUPPRESSES any play that doesn't ground on a reputation-family signal;
//  (2) a template kill-list drops "reply to your reviews"-class advice AND
//      policy-violating advice (gating, incentives, buy/scrub reviews) — v1's literal
//      fallback title cannot survive parse;
//  (3) confidence is calibrated in the playbook, never hardcoded (the menu-price
//      postmortem: hardcoded confidence is banned);
//  (4) stance is stamped DELIBERATELY: the model is instructed per archetype, and
//      parse() backstops an unset stance from the cited signals' severity (fix on a
//      warning/critical ref, capture otherwise; maintain only ever model-chosen).
//
// INTAKE (widened but capped): v1's ["rating","review"] prefixes missed the weekly
// trend rules entirely (weekly_rating_trend / weekly_review_trend start with
// "weekly_"). v2 claims all seven real review-family rule outputs:
//   rating_change, weekly_rating_trend            -> rating trajectory
//   review_velocity_falling/_rising, weekly_review_trend -> review flow
//   review.theme (own, from dossier build)        -> own themes (verbatim examples)
//   review_themes (competitor, insights pipeline) -> competitor themes
// The rich ownReviewThemes/competitor context blocks are REASONING material only;
// grounding still rests on the rule-output refs above (buildRefIndex closes the set).
//
// ENTITY-ATTRIBUTION HONESTY: rating_change / review_velocity_* / weekly_* rows are
// written by the COMPETITOR diff loop today and the dossier row does not carry which
// entity moved. The model path gets an explicit doctrine rule (own-listing numbers
// are the source of truth for the operator's own rating; never claim "your rating
// fell" from a bare change signal). The canned floor cannot read that nuance, so
// those signals are EXCLUDED as floor triggers (v1's floor fired its template off a
// competitor's velocity drop — misattributed; that defect dies here).
//
// HONEST FLOOR: deterministic fallback fires ONLY on a warning/critical own review
// theme (review.theme — the one unambiguous reputation failure signal), emits at
// most ONE number-free play, and passes its own parse gates + lintVoice. Info-grade
// signals never manufacture a play (the quiet-week golden contract).
//
// TOKEN BUDGET: every input family is hard-capped (guerrilla precedent: a ~40k-char
// prompt at medium effort silently timed out into the fallback). Effort stays at the
// default (medium); if p95 latency nears the 120s abort, flip `effort: "low"`.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { selectAdjacentSignals } from "@/lib/skills/domain-map"
import { REPUTATION_KNOWLEDGE } from "@/lib/skills/reputation/knowledge"

const KNOWLEDGE_VERSION = "reputation@v2"

// ── The reputation archetypes (stable keys — the click-feedback sub-domain the
//    rollup can learn by, mirroring MARKETING_ARCHETYPES / GRASSROOTS_ARCHETYPES).
//    Defined in the knowledge playbook. ──
export const REPUTATION_ARCHETYPES = [
  "response_recovery_arc",
  "theme_to_fix",
  "red_flag_triage",
  "threshold_watch",
  "competitor_review_intel",
  "dispute_removal",
] as const
export type ReputationArchetype = (typeof REPUTATION_ARCHETYPES)[number]

// ── Signal families (the widened intake). Prefix-matched against insight_type; the
//    same predicates gate parse(), so intake and grounding stay in lockstep.
//    OVERLAP IS DELIBERATE: marketing's guest-voice family also reads rating/review
//    signals — the same evidence carries a different play per expert (marketing earns
//    reviews and amplifies praise; reputation fixes, responds, and reads the field).
//    The knowledge playbook's WHAT YOU ARE NOT block keeps the OUTPUT lanes separate. ──
function isRatingTrajectorySignal(t: string): boolean {
  // rating_change (daily diff) + weekly_rating_trend (t-7 diff; v1 missed it — the
  // "weekly_" prefix fell outside v1's ["rating","review"] intake).
  return t.startsWith("rating") || t.startsWith("weekly_rating")
}
function isReviewFlowSignal(t: string): boolean {
  // review_velocity_falling / review_velocity_rising + weekly_review_trend (also
  // previously orphaned by the prefix gap).
  return t.startsWith("review_velocity") || t.startsWith("weekly_review")
}
function isOwnThemeSignal(t: string): boolean {
  // review.theme — own-review themes with verbatim examples, pushed at dossier build.
  // The ONE reputation signal whose entity attribution is unambiguous (always own).
  return t.startsWith("review.theme")
}
function isCompetitorThemeSignal(t: string): boolean {
  // review_themes — competitor review themes from the insights pipeline narrative pass.
  return t.startsWith("review_themes")
}
export function isReputationSignal(t: string): boolean {
  return (
    isRatingTrajectorySignal(t) ||
    isReviewFlowSignal(t) ||
    isOwnThemeSignal(t) ||
    isCompetitorThemeSignal(t)
  )
}

// ── Template kill-list (the analogue of marketing's TEMPLATE_PENALTY_PATTERNS).
//    Three classes die here:
//    (1) generic reply-to-your-reviews advice (v1's literal fallback title included) —
//        the founder-flagged sameness failure mode;
//    (2) the CEDED earn-side ("ask for reviews", "get more reviews") — marketing@v2
//        owns the REVIEW_ENGINE lane; a reputation play may flag urgency for it but
//        never write the ask itself;
//    (3) policy-violating moves (gating, incentives, buying/scrubbing reviews) and
//        the corporate-boilerplate response tells the research shows actively hurt
//        ("we take all feedback seriously", "sorry for your experience"). ──
const TEMPLATE_PENALTY_PATTERNS = [
  /act on what your reviews are telling you/i, // v1's literal fallback title — never let the model echo it
  /\b(?:reply|respond) to (?:your |the |all |every |negative |positive |new |recent )*reviews\b/i,
  /\bthank (?:your |the )?reviewers\b/i,
  /\bmonitor your (?:online )?(?:reputation|reviews)\b/i,
  /\bkeep an eye on (?:your )?reviews\b/i,
  /\bstay on top of (?:your )?reviews\b/i,
  /\bimprove your online reputation\b/i,
  // the ceded earn-side — marketing owns the ask:
  /\bask for (?:a |more )?reviews?\b/i,
  /\bask (?:your )?(?:happy )?(?:customers|guests|diners|regulars) (?:for|to leave|to write|to post)\b/i,
  /\bget more reviews\b/i,
  /\bencourage (?:customers|guests|diners) to (?:leave|write|post)\b/i,
  /\bboost your (?:star )?rating\b/i,
  // policy red lines — gating, incentives, buying, scrubbing:
  /\bonly ask (?:your )?happy (?:customers|guests|diners)\b/i,
  /\bin exchange for (?:a |an )?(?:positive |5-star |five-star )?review/i,
  /\b(?:discount|free (?:item|meal|dessert|appetizer|drink)|gift card) for (?:a |every )?review/i,
  /\b(?:buy|purchase|pay for) (?:positive )?reviews?\b/i,
  /\b(?:delete|take down|remove|bury|suppress) (?:the |every |all )?(?:bad |negative |critical )+reviews?\b/i,
  // corporate-boilerplate response tells (the template-response backfire research):
  /\bwe (?:take|value) (?:all )?(?:your |customer )?feedback seriously\b/i,
  /\bsorry (?:for|about) your experience\b/i,
  /\bwe strive to (?:provide|deliver|offer)\b/i,
]

/** True when a play's user-facing text reads as generic review-handling advice,
 *  the ceded earn-side, or a policy-violating move. */
export function isTemplateAdvice(text: string): boolean {
  return TEMPLATE_PENALTY_PATTERNS.some((re) => re.test(text))
}

/** Capped, prefix-filtered slice of grounded rule outputs (token-budget discipline). */
function take(d: Dossier, pred: (t: string) => boolean, cap: number) {
  return d.ruleOutputs.filter((i) => pred(i.insight_type)).slice(0, cap)
}

// ── Input selection (what the model reasons over) ──────────────────────────────────
function selectInput(d: Dossier) {
  // P5 adjacency unchanged: operations neighbors (traffic./hours) are often what the
  // bad reviews are ABOUT — the theme-to-fix archetype ties a review theme to its
  // operational cause. Omitted when none.
  const adjacentSignals = selectAdjacentSignals(d, "reputation")
  // Own themes as reasoning context: the full craft material (sentiment, mention
  // counts, up to two verbatim examples each — sentiment.ts already caps examples at
  // 2). Capped at 8 themes so a chatty analyzer can't blow the budget. Claims about
  // what guests say must trace to these + the review.theme refs.
  const ownReviewThemes = (d.location.reviews?.themes ?? [])
    .slice()
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 8)
    .map((t) => ({ theme: t.theme, sentiment: t.sentiment, mentions: t.mentions, examples: t.examples.slice(0, 2) }))
  // Own listing numbers — the source of truth for the operator's OWN rating and
  // review count (v1 never passed these; threshold-watch is impossible without them).
  const ownProfile = d.location.listing?.profile
    ? {
        rating: d.location.listing.profile.rating ?? null,
        reviewCount: d.location.listing.profile.reviewCount ?? null,
      }
    : null
  return {
    // HOME-TURF GROUNDED SIGNALS by family (each capped; these are the citable refs).
    ratingTrajectorySignals: take(d, isRatingTrajectorySignal, 4),
    reviewFlowSignals: take(d, isReviewFlowSignal, 4),
    ownThemeSignals: take(d, isOwnThemeSignal, 8),
    competitorThemeSignals: take(d, isCompetitorThemeSignal, 5),
    // CONTEXT (reasoning material — grounding still rests on the rule outputs above).
    ownProfile,
    ...(ownReviewThemes.length ? { ownReviewThemes } : {}),
    // Competitor field read: listing numbers (rating/review count per named rival —
    // the velocity-vs-competitors and wobble raw material) + their themes when the
    // sentiment plumbing populates them (null today for competitors; fail-soft by
    // design — the review_themes SIGNALS above are the citable competitor-theme refs).
    competitorField: d.competitors.slice(0, 5).map((c) => ({
      name: c.name,
      rating: c.listing?.profile?.rating ?? null,
      reviewCount: c.listing?.profile?.reviewCount ?? null,
      themes: (c.reviews?.themes ?? [])
        .slice(0, 4)
        .map((t) => ({ theme: t.theme, sentiment: t.sentiment, mentions: t.mentions, example: t.examples[0] ?? null })),
    })),
    // Segment read (drives which archetypes fit — see SEGMENT AWARENESS in the playbook).
    segment: {
      tier: d.tier.tier,
      maxLocations: d.tier.maxLocations,
      serviceModel: d.profile.attributes.serviceModel ?? null,
    },
    ...(adjacentSignals.length ? { adjacentSignals } : {}),
  }
}

// ── Parse: shared coercion + the reputation quality gates ────────────────────────────
//  (1) every play grounds on ≥1 reputation-family signal (run.ts also ground-filters
//      against allowedEvidenceRefs; this enforces the DOMAIN so a play can't ride
//      solely on a borrowed operations ref);
//  (2) template advice, the ceded earn-side, and policy-violating moves are SUPPRESSED
//      (the kill-list above);
//  (3) stance backstop: keep the model's deliberate stance; when unset, stamp "fix" if
//      any cited reputation ref resolves to a warning/critical rule output, else
//      "capture". "maintain" is only ever model-chosen (scoring caps its impact —
//      never weaken that by inferring it).
function parse(raw: unknown, d: Dossier): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "reputation",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "reputation",
    defaultOwner: "owner",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  const severityByType = new Map(d.ruleOutputs.map((i) => [i.insight_type, i.severity] as const))
  return coerced
    .filter((p) => {
      if (!p.evidenceRefs.some(isReputationSignal)) return false // (1) domain grounding
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      if (isTemplateAdvice(text)) return false // (2) kill generic / ceded / policy-violating output
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

// ── Deterministic, grounded, NUMBER-FREE fallback ───────────────────────────────────
// NARROW BY DESIGN: the floor fires ONLY on a warning/critical OWN review theme
// (review.theme) — the one reputation failure signal whose entity attribution is
// unambiguous. Rating/velocity change signals are deliberately NOT floor triggers:
// those dossier rows are competitor-scoped diffs that don't name the entity, and a
// canned template can't read that nuance (v1's floor misattributed them). The model
// path handles them with the entity-attribution doctrine instead. Info-grade signals
// (positive themes, competitor theme summaries) never manufacture a floor play — a
// quiet week stays an honest quiet brief.
function fallback(d: Dossier): EnrichedRecommendation[] {
  const ins = d.ruleOutputs.find(
    (i) => isOwnThemeSignal(i.insight_type) && (i.severity === "warning" || i.severity === "critical"),
  )
  if (!ins) return []
  return [
    {
      // Note what this floor deliberately does NOT do: no canned reply draft. v1's
      // floor shipped copy ("Thank you for the honest note...") — a paste-anywhere
      // template is the exact response pattern the evidence says backfires, so the
      // floor prescribes the arc and leaves the words to the owner.
      title: "Fix the complaint your reviews repeat, then show the fix",
      rationale: `Grounded in ${ins.title}. The same problem keeps coming up in your recent reviews. Fix the cause first, then answer each review that raised it: name the specific thing that went wrong, apologize once, say what changed, and invite the guest to reach you directly. Every future reader judges you on that answer, not on the complaint.`,
      skillId: "reputation",
      ownerRole: "owner" as const,
      kind: "reputation" as const,
      stance: "fix" as const, // a warning-grade own complaint theme is a real problem to fix
      recipe: [
        {
          channel: "Google Business review replies, after the fix is made",
          platforms: [],
          audience: "the guests who raised it and every future reader deciding from your reviews",
          window: { note: "make the fix this week, then answer the affected reviews within a day or two" },
          dependencies: [
            "the operational fix itself, before any public reply",
            "owner or manager time to write each answer personally, no copy-paste template",
          ],
        },
      ],
      confidence: "medium" as const,
      leverage: {
        label: "medium" as const,
        basisInternal: "fallback play; reputation lift sized ordinally; a live complaint theme answered with a visible fix is the cheapest trust lever available",
      },
      evidenceRefs: [ins.insight_type],
      knowledgeVersion: KNOWLEDGE_VERSION,
    },
  ]
}

export const reputationSkill: ProducerSkill = {
  id: "reputation",
  displayName: "Reputation & Reviews expert",
  ownerRole: "owner",
  kind: "reputation",
  category: "reputation",
  tier: "reasoning",
  // effort left at the default (medium): the input is hard-capped per family, so the
  // prompt stays well under the ~40k-char size that forced guerrilla to "low".
  // WATCH ITEM: if p95 nears the 120s abort once competitor review sentiment lands,
  // flip to `effort: "low"` (the proven lever) rather than degrading to the fallback.
  //
  // temperature stays at v1's 0.4 (vs marketing's 0.6) ON PURPOSE: this skill emits
  // compliance-sensitive guidance (platform rules, dispute expectations, response
  // drafts) where precision beats spread; boldness comes from the playbook, not heat.
  temperature: 0.4,
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: REPUTATION_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(reputationSkill, d, selectInput(d), k),
  parse,
  fallback,
  // P14 learning hook (new in v2, mirrors marketing): click feedback becomes learnable
  // per-archetype via REPUTATION_ARCHETYPES keys; external trend/editorial snippets
  // (e.g. platform policy changes) may inform the prompt but never add citable refs.
  learning: {
    streams: ["external", "click", "ask"],
    playTypeLeadDomain: "reputation",
    acceptedLearningKinds: ["external_trend", "editorial"],
  },
}
