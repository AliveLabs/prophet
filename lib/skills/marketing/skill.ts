// ---------------------------------------------------------------------------
// Marketing / Growth skill — REWRITTEN (marketing@v2, 2026-07-02) from a social-only
// content advisor into a signal-first marketing strategist.
//
// WHY: v1's evidentiary universe was social.* rule outputs only, so its plays
// structurally converged on "post more" (the PR-firm review finding). v2 widens the
// intake to every marketing-relevant signal family the dossier already carries —
// social/visual proof, demand rhythm (traffic/hours), guest voice (rating/review),
// competitor moves (photo diffs, search visibility, competitor events) — and maps
// each family to a named archetype (see MARKETING_ARCHETYPES + the knowledge
// playbook). Current hours/dayparts are treated as VARIABLES to test via clearly
// labeled trials (the counterfactual mandate), not walls.
//
// QUALITY MECHANISM (mirrors guerrilla-marketing's P16 upgrade, the proven pattern):
//  (1) parse() SUPPRESSES any play that doesn't ground on a marketing-family signal;
//  (2) a template kill-list drops "post more"-class advice (the three complained-of
//      templates can no longer survive parse);
//  (3) confidence is calibrated in the playbook, never hardcoded (see the
//      menu-price-comparison postmortem — hardcoded confidence is banned);
//  (4) every play ships as a pilot with an operator-run tracking mechanism and a
//      matched-day baseline named in the rationale (no invented numbers).
//
// FAIL-SOFT: with none of the widened signals present, the new archetypes simply
// don't fire; input fields are omitted/null and the prompt degrades toward v1's
// shape. competitorBusyTimes is typed on EntitySignals but not yet populated by
// buildDossier's competitor path (plumbing gap, see rationale.md) — it rides as
// null until that lands and the daypart-gap exemplars then get their raw material.
//
// HONEST FLOOR: the deterministic fallback only fires on warning/critical-grade
// signals and only on competitor-SCOPED conquest triggers — an info-grade signal or
// an own-win seo signal must never manufacture a canned play (the quiet-week golden
// scenario is the contract: a quiet week stays an honest quiet brief). Bold plays on
// soft signals are the MODEL's job, where the framing can be earned (amplify-the-win).
//
// T1 (2026-07-03): the rhythm family's floor is now RESTRICTED via a pick override to
// traffic.competitive_opportunity only (see lib/jobs/pipelines/traffic.ts's previous-
// snapshot wiring). Arming traffic.surge/peak_shift/extended_busy/new_slow_period would
// otherwise let the plain warning-gate below fire "sell your quiet window" grounded in
// a RIVAL's traffic going UP — the same misattribution class reputation@v2 and
// operations@v2 already fixed. traffic.competitive_opportunity (the set-wide "all
// competitors slow at this hour" read) is the one honest sell-your-window trigger.
//
// TOKEN BUDGET: every input family is capped (guerrilla precedent: a ~40k-char
// prompt at medium effort silently timed out into the fallback). If p95 latency
// nears 120s once competitor busy-times data lands, flip `effort: "low"` on the
// skill below — same lever guerrilla uses.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { selectAdjacentSignals } from "@/lib/skills/domain-map"
import { MARKETING_KNOWLEDGE } from "@/lib/skills/marketing/knowledge"

const KNOWLEDGE_VERSION = "marketing@v2"

// ── The marketing archetypes (stable keys — the click-feedback sub-domain the rollup
//    can learn by, mirroring GRASSROOTS_ARCHETYPES). Defined in the knowledge playbook. ──
export const MARKETING_ARCHETYPES = [
  "own_the_lull",
  "daypart_expansion_trial",
  "anchor_night",
  "signature_item_campaign",
  "review_engine",
  "conquest_counter",
  "amplify_the_win",
  "owned_channel_engine",
  "content_multiplier",
  "photo_worthy_moment",
  "moment_tie_in",
] as const
export type MarketingArchetype = (typeof MARKETING_ARCHETYPES)[number]

// ── Signal families (the widened intake). Prefix-matched against insight_type; the
//    same predicates gate parse(), so intake and grounding stay in lockstep.
//    OVERLAP IS DELIBERATE: traffic./hours are also operations' turf, rating/review
//    reputation's, events. local-demand's — the same evidence carries a different play
//    per expert (precedent: guerrilla already grounds on events./traffic.). The
//    knowledge playbook's WHAT YOU ARE NOT block keeps the OUTPUT lanes separate. ──
function isSocialProofSignal(t: string): boolean {
  // social.* (v1's whole universe) + visual.* (previously orphaned: a competitor's
  // visual upgrade / category shift is a marketing early-warning, not just decoration).
  return t.startsWith("social.") || t.startsWith("visual.")
}
function isRhythmSignal(t: string): boolean {
  // Busy-curve + hours signals — the raw material of the counterfactual mandate.
  return t.startsWith("traffic.") || t.startsWith("hours")
}
function isGuestVoiceSignal(t: string): boolean {
  // Rating trajectory + review velocity/themes — signature-item + review-engine fuel.
  return t.startsWith("rating") || t.startsWith("review")
}
function isCompetitorMoveSignal(t: string): boolean {
  // photo.* (promo/price-change photo diffs — previously consumed by NO skill),
  // seo_* (keyword wins/losses, a rival's ad push — previously 9 of 11 types orphaned),
  // events.competitor_* (a rival's event series — previously only "prepare" framing).
  return t.startsWith("photo.") || t.startsWith("seo_") || t.startsWith("events.competitor_")
}
function isMomentSignal(t: string): boolean {
  // Tie-in grounding for moment plays (metro hooks themselves are calendar context,
  // not rule outputs — a tie-in play still needs a citable events.* ref when it exists).
  return t.startsWith("events.")
}
export function isMarketingSignal(t: string): boolean {
  return (
    isSocialProofSignal(t) ||
    isRhythmSignal(t) ||
    isGuestVoiceSignal(t) ||
    isCompetitorMoveSignal(t) ||
    isMomentSignal(t)
  )
}

// ── Template kill-list (the analogue of guerrilla's GENERIC_PENALTY_PATTERNS).
//    These are the phrasings the founder review flagged as the failure mode — a play
//    whose user-facing text reads as one of them is SUPPRESSED in parse, so the three
//    complained-of templates cannot survive even if the model emits them. ──
const TEMPLATE_PENALTY_PATTERNS = [
  /\bpost more\b/i,
  /\bpost (more )?(consistently|regularly|frequently)\b/i,
  /tighten your content plan/i, // v1's literal fallback title — never let the model echo it
  /\bbe (more )?active on social\b/i,
  /\bengage with (your )?(followers|audience|community)\b/i,
  /\bboost your (online|social media) presence\b/i,
  /\bleverage social media\b/i,
  /\braise awareness\b/i,
  /\bspread the word\b/i,
  /\bstaff up\b/i, // staffing is the operations skill's lane — a marketing play never leads with it
]

/** True when a play's user-facing text reads as generic content-cadence advice. */
export function isTemplateAdvice(text: string): boolean {
  return TEMPLATE_PENALTY_PATTERNS.some((re) => re.test(text))
}

/** Capped, prefix-filtered slice of grounded rule outputs (token-budget discipline). */
function take(d: Dossier, pred: (t: string) => boolean, cap: number) {
  return d.ruleOutputs.filter((i) => pred(i.insight_type)).slice(0, cap)
}

// ── Input selection (what the model reasons over) ──────────────────────────────────
function selectInput(d: Dossier) {
  // P5 adjacency unchanged: local-demand + reputation neighbors sharpen the angle.
  const adjacentSignals = selectAdjacentSignals(d, "marketing")
  // Guest voice as reasoning context: top praised/complained themes with ONE verbatim
  // example each (the signature-item raw material). Trimmed hard — the full themes
  // array with all examples would blow the budget.
  const reviewThemes = (d.location.reviews?.themes ?? [])
    .slice()
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 6)
    .map((t) => ({ theme: t.theme, sentiment: t.sentiment, mentions: t.mentions, example: t.examples[0] ?? null }))
  return {
    // HOME-TURF GROUNDED SIGNALS by family (each capped; these are the citable refs).
    socialProofSignals: take(d, isSocialProofSignal, 8),
    demandRhythmSignals: take(d, isRhythmSignal, 6),
    guestVoiceSignals: take(d, isGuestVoiceSignal, 6),
    competitorMoveSignals: take(d, isCompetitorMoveSignal, 6),
    // CONTEXT (reasoning material — grounding still rests on the rule outputs above).
    ownSocial: d.location.social ?? null,
    ownVisual: d.location.visual ?? null,
    competitorSocial: d.competitors
      .slice(0, 5)
      .map((c) => ({ name: c.name, social: c.social ?? null, visual: c.visual ?? null })),
    ...(reviewThemes.length ? { reviewThemes } : {}),
    // DEMAND-RHYTHM raw material for the counterfactual plays: own curve + hours, and
    // each rival's curve trimmed to WINDOW grain (day name + peak hour/level + slow
    // hours) — mirrors operations/skill.ts exactly. buildDossier now populates competitor
    // busyTimes from stored rows (T3), so the full 5 rivals x 7 days x 24 hourly scores
    // would blow the token budget (~56k, past the ~40k timeout precedent); the drift/gap
    // reads all happen at window grain, so the hourly arrays are dropped here. Fail-soft:
    // days is null when a rival has no stored curve yet.
    ownBusyTimes: d.location.busyTimes ?? null,
    competitorBusyTimes: d.competitors.slice(0, 5).map((c) => ({
      name: c.name,
      days:
        c.busyTimes?.days.map((day) => ({
          day_of_week: day.day_of_week,
          day_name: day.day_name,
          peak_hour: day.peak_hour,
          peak_score: day.peak_score,
          slow_hours: day.slow_hours,
        })) ?? null,
    })),
    ownHours: d.profile.hours ?? null,
    // Far-away MAJOR events (metro attention moments) — TIE-IN material only, rules
    // unchanged from v1 (see the metro-hook rules in the playbook + EVENT_GEOGRAPHY).
    metroAttentionHooks: (d.demandCalendar.metroHooks ?? []).slice(0, 3).map((e) => ({
      title: e.title,
      when: e.startDatetime,
      venue: e.venue?.name,
      distanceMiles: e.distanceMiles,
      magnitude: e.magnitude,
      role: e.role,
    })),
    // Segment read (drives which archetypes fit — see SEGMENT AWARENESS in the playbook).
    segment: {
      tier: d.tier.tier,
      maxLocations: d.tier.maxLocations,
      seats: d.profile.capability.seats ?? null,
      serviceModel: d.profile.attributes.serviceModel ?? null,
    },
    ...(adjacentSignals.length ? { adjacentSignals } : {}),
  }
}

// ── Parse: shared coercion + the marketing quality gates ────────────────────────────
//  (1) every play grounds on ≥1 marketing-family signal (run.ts also ground-filters
//      against allowedEvidenceRefs; this enforces the DOMAIN so a play can't ride
//      solely on a borrowed adjacent ref);
//  (2) template-advice plays are SUPPRESSED (the kill-list above).
// (Takes only `raw`: fewer-params functions satisfy ProducerSkill.parse's (raw, d)
// contract, and no gate here needs the dossier yet.)
function parse(raw: unknown): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "marketing",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "capitalize",
    defaultOwner: "marketing",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  return coerced.filter((p) => {
    if (!p.evidenceRefs.some(isMarketingSignal)) return false // (1) domain grounding
    const text = `${p.title} ${p.rationale} ${p.recipe
      .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
      .join(" ")}`
    if (isTemplateAdvice(text)) return false // (2) kill "post more"-class output
    return true
  })
}

// ── Deterministic, grounded, NUMBER-FREE fallback ───────────────────────────────────
// Family-aware: picks the strongest signal families present (priority: rhythm → guest
// voice → competitor move → social) and emits a family-shaped play, so even the floor
// is sharper than v1's single "tighten your content plan" template. Never fabricates.

// Fallback-only conquest trigger: competitor-SCOPED moves. The intake predicate above
// stays broad (the model reads each signal's title/summary and can route "your visibility
// is up" to amplify-the-win vs "a rival's ad push" to conquest-counter), but this canned
// floor cannot read nuance — an own-win seo signal selecting the conquest template is
// exactly the slop the quiet-week golden scenario exists to catch.
function isCompetitorMoveTrigger(t: string): boolean {
  return t.startsWith("photo.") || t.startsWith("events.competitor_") || (t.startsWith("seo_") && t.includes("competitor"))
}

function fallback(d: Dossier): EnrichedRecommendation[] {
  const families: Array<{
    pred: (t: string) => boolean
    /** Optional floor-only trigger override. The praise play must fire ONLY on a POSITIVE
     *  own review theme (exempt from the warning gate below — repeated praise is legitimate
     *  capture material, not manufactured urgency). A NEGATIVE theme is reputation@v2's
     *  fix-side floor; rating/velocity diffs are ambiguous-attribution and match no floor.
     *  Without this, the praise template could fire off a complaint theme (positive themes
     *  are info-severity, so the warning gate alone selects exactly the wrong rows). */
    pick?: (dd: Dossier) => Dossier["ruleOutputs"][number] | undefined
    title: string
    rationale: (insightTitle: string) => string
    channel: string
    audience: string
    windowNote: string
    creativeDirection: string
    dependencies: string[]
  }> = [
    {
      pred: isRhythmSignal,
      // T1: arming traffic.surge/peak_shift/extended_busy/new_slow_period (previously
      // dormant — the traffic pipeline hardcoded previous:null) would otherwise let this
      // family's warning-gate fire off a RIVAL's surge — the same misattribution class
      // reputation@v2 and operations@v2 already fixed (this play would tell the operator
      // to "sell your quiet window" grounded in a competitor's traffic going UP, not down).
      // Restrict the floor to traffic.competitive_opportunity — the set-wide "all
      // competitors slow at this hour" read is the one honest sell-your-window trigger.
      // It is info-severity by design, so this pick is exempt from the warning gate below
      // (precedent: the guest-voice praise-floor pick above/below).
      pick: (dd) => dd.ruleOutputs.find((i) => i.insight_type === "traffic.competitive_opportunity"),
      title: "Sell your quiet window instead of waiting it out",
      rationale: (t) =>
        `Grounded in ${t}. Pick the slow window this signal shows, attach one named offer to it, and tell people it exists. Track it with a code word so you can count who came for it against a normal week.`,
      channel: "Google Business + your live social channels + an in-store sign",
      audience: "nearby diners deciding where to go this week",
      windowNote: "the quiet window the signal shows, for the next two weeks",
      creativeDirection:
        "on your phone, one clear photo of the dish or drink that anchors the offer, taken in daylight; put the offer name on a simple sign at the door",
      dependencies: ["a code word or counted cards to track redemptions", "about an hour to set up"],
    },
    {
      pred: isGuestVoiceSignal,
      pick: (dd) => dd.ruleOutputs.find((i) => i.insight_type === "review.theme" && i.evidence?.["sentiment"] === "positive"),
      title: "Put the thing your reviews praise to work",
      rationale: (t) =>
        `Grounded in ${t}. When guests keep praising the same thing unprompted, that is your ad already written. Name it, photograph it, and lead every channel with it this week; count its sales before and after.`,
      channel: "Google Business + your live social channels + the menu",
      audience: "locals reading your reviews and profile before choosing",
      windowNote: "this week, then hold for a month",
      creativeDirection:
        "on your phone, capture the praised dish or moment as it lands on the table, in daylight near a window; use the best single shot everywhere",
      dependencies: ["your phone", "a menu or table-card tweak to name the item"],
    },
    {
      pred: isCompetitorMoveTrigger,
      title: "Answer the competitor's move while it is fresh",
      rationale: (t) =>
        `Grounded in ${t}. A competitor near you just changed their game. Decide your counter this week: beat it with added value, or own the audience and occasion their move ignores. Do not match on price.`,
      channel: "Google Business + your live social channels",
      audience: "the same nearby diners the competitor's move is courting",
      windowNote: "this week, while their move is still the local conversation",
      creativeDirection:
        "on your phone, one photo or short clip that shows the thing you do that their move cannot; plain, honest, no digs at them by name",
      dependencies: ["a decision on the counter: added value or a different audience", "about an hour"],
    },
    {
      pred: isSocialProofSignal,
      title: "Double down on the format the numbers say is winning",
      rationale: (t) =>
        `Grounded in ${t}. The engagement pattern names a winning format. Feed that exact format on a cadence you can keep, and give the feed its best single frame.`,
      channel: "your live social channels",
      audience: "locals who follow you and look-alikes nearby",
      windowNote: "this week, on a repeatable cadence",
      creativeDirection:
        "on your phone, capture the format the signal says is winning (a short vertical video for Instagram/TikTok, or one clear photo for the feed); shoot in daylight, no fancy setup",
      dependencies: ["your phone", "about 15 minutes per post"],
    },
  ]
  const out: EnrichedRecommendation[] = []
  for (const fam of families) {
    if (out.length >= 2) break // v1's cap preserved: the fallback floor stays small
    // Severity gate: the floor never manufactures urgency from an info-grade signal — a
    // quiet week must stay an honest quiet brief (the golden-scenario contract). Info
    // signals remain model-path context, where a bold play can earn its framing.
    // (A family's `pick` override replaces this gate with its own, stricter trigger.)
    const ins = fam.pick ? fam.pick(d) : d.ruleOutputs.find((i) => fam.pred(i.insight_type) && i.severity !== "info")
    if (!ins) continue
    out.push({
      title: fam.title,
      rationale: fam.rationale(ins.title),
      skillId: "marketing",
      ownerRole: "marketing" as const,
      kind: "capitalize" as const,
      stance: "capture" as const,
      recipe: [
        {
          channel: fam.channel,
          platforms: d.tier.ownSocialPlatforms,
          audience: fam.audience,
          window: { note: fam.windowNote },
          creativeDirection: fam.creativeDirection,
          dependencies: fam.dependencies,
        },
      ],
      confidence: "medium" as const,
      leverage: {
        label: "medium" as const,
        basisInternal: "fallback play; upside sized ordinally from the triggering signal, no figure available",
      },
      evidenceRefs: [ins.insight_type],
      knowledgeVersion: KNOWLEDGE_VERSION,
    })
  }
  return out
}

export const marketingSkill: ProducerSkill = {
  id: "marketing",
  displayName: "Marketing & Campaign expert",
  ownerRole: "marketing",
  kind: "capitalize",
  category: "marketing",
  tier: "reasoning",
  // effort left at the default (medium): the widened input is hard-capped per family,
  // so the prompt stays well under the ~40k-char size that forced guerrilla to "low".
  // WATCH ITEM: if p95 nears the 120s abort once competitor busy-times data lands,
  // flip to `effort: "low"` (the proven lever) rather than letting the skill silently
  // degrade to the fallback.
  temperature: 0.6,
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: MARKETING_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(marketingSkill, d, selectInput(d), k),
  parse,
  fallback,
  // P14 learning hook unchanged: industry/menu-trend sources, click feedback (now
  // learnable per-archetype via MARKETING_ARCHETYPES keys), and ask routing.
  learning: {
    streams: ["external", "click", "ask"],
    playTypeLeadDomain: "marketing",
    acceptedLearningKinds: ["external_trend", "editorial"],
  },
}
