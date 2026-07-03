// ---------------------------------------------------------------------------
// Food-Pairing / Kitchen skill — RETROFIT (food-pairing@v2, 2026-07-03) of a
// solid, deliberately-fundamentals v1.1 into the program pattern. SEVENTH skill
// in the one-at-a-time mastery program; marketing@v2, reputation@v2,
// operations@v2, local-demand@v2, positioning@v4 (all on main) and social-counter
// (mastering) are the proven templates.
//
// SCOPE DISCIPLINE (Bryan's explicit call, documented in the v1.1 code comments):
// food-pairing is FUNDAMENTALS-ONLY BY DESIGN — "obvious things so we don't make
// stupid recommendations", NOT a sommelier course; tasting-menu nuance is
// deliberately OUT OF SCOPE ("those kitchens don't need us"). This is the
// lowest-stakes skill of the nine. The v1.1 OBVIOUS PAIRINGS guardrails are GOOD
// and largely correct — v2 applies the PROGRAM PATTERN (archetypes, kill-list,
// stance backstop, honest floor, boundaries, attribution table) to that content;
// it does NOT make it fancier or longer. A tight, correct retrofit beats an
// ambitious rewrite. The v1.1 "don't be stupid, stay fundamental" intent is
// preserved verbatim in spirit.
//
// VERSION STRING: food-pairing@v2. History carries only @v1 (edca32c, P6 expert
// roster) and @v1.1 (the OBVIOUS PAIRINGS guardrails) — verified via
// `git log -S "food-pairing@v"`. Unlike positioning (whose @v2/@v3 were already
// consumed, forcing @v4), @v2 here is clean and monotonic; the feedback rollup
// keys on knowledgeVersion and @v2 does not collide with any persisted play.
//
// VERIFIED SIGNAL REALITY (read from lib/content/insights.ts +
// lib/insights/weather-context.ts — NOT assumed from type names; positioning@v4
// and local-demand@v2 already mapped most of these and their tables cross-check):
//   menu.signature_item_missing   comp-vs-own  info ALWAYS   NAME-set diff (>=3 items);
//                                                            a differently-worded dish counts
//                                                            as "missing" — the weakest row
//   menu.category_gap             comp-vs-own  info ALWAYS   name-level category diff, dine-in
//   menu.promo_signal_detected    competitor   info ALWAYS   promo keyword present there, not here
//   menu.menu_change_detected     OWN          info ALWAYS   own scrape item-count delta >=3 —
//                                                            the PUBLIC surface, not the kitchen
//   visual.weather_patio          area*        info ALWAYS   weather pipeline; notability-gated
//                                                            (a pleasant break vs the recent
//                                                            stretch, never routine heat);
//                                                            *patio-photo evidence is COMPETITOR
//                                                            photos (local-demand finding)
//   traffic.weather_suppression   ctx          info ALWAYS   fires on severe days; confidence high
// THE CENTRAL SEVERITY FACT: ALL SIX of this skill's signals are severity "info"
// BY CONSTRUCTION (verified against the generating code). There is no severity
// ladder to gate on — so, unlike the five severity-gated siblings, this skill's
// floor CANNOT be warning/critical-gated (that would silence it on every signal it
// owns, and take the patio-weather golden red). The honesty is carried instead by
// (a) the DOMAIN gate — only a real menu/weather-cue signal, never a feature
// manufactured from an info-only non-signal week; (b) CONCEPT gates — the patio
// flag, the alcohol/daypart guards from the playbook; (c) the generators' OWN
// gates — the weather signal's notability gate is in code. This is the same argued
// deviation local-demand@v2 made for its patio floor (its generator also hardcodes
// info); documented in rationale.md.
//
// EXCLUDED ON PURPOSE (positioning@v4's territory, already clean): the price rows
// menu.price_positioning_shift + menu.catering_pricing_gap. Matched EXACTLY (not by
// the bare `menu.` prefix) so a price row can never route here — food-pairing
// features an existing dish; it never reprices and never restructures the menu.
// visual.weather_patio is a DELIBERATE SHARED read with local-demand@v2 (they shift
// channel/staffing for the weather; food-pairing changes WHAT is on the plate) —
// the program's standing same-evidence-different-play pattern.
//
// QUALITY MECHANISM (mirrors the exemplars):
//  (1) parse() SUPPRESSES any play that doesn't ground on a food-pairing-family
//      signal (and the excluded price rows are OUTSIDE that family, so a play
//      riding a price signal dies at the gate);
//  (2) a template kill-list drops generic "feature your best dish" / "promote a
//      special"-class advice AND every canned rec string the menu/weather rules
//      embed in their own recommendations ("Consider adding ...", "Explore adding
//      popular competitor items", "Update your online presence", "Highlight
//      outdoor dining options", "Focus on delivery and indoor experience") so the
//      model can never parrot its own input; v1.1's floor titles are REPLACED and
//      the old ones killed;
//  (3) confidence is calibrated in the playbook, never hardcoded (the menu-price
//      postmortem: hardcoded confidence is banned);
//  (4) stance is stamped DELIBERATELY per archetype in the playbook, and parse()
//      backstops an unset stance from the cited signals' severity (fix on
//      warning/critical, capture otherwise; maintain never inferred — a feature is
//      a this-week move, not a standing habit).
//
// TOKEN BUDGET: the menu is already DISTILLED to names+tags (summarizeMenu, kept
// from v1.1) and every signal family is capped — the prompt stays far under the
// ~40k-char size that once forced guerrilla to "low". Effort stays default
// (medium); flip `effort: "low"` if p95 ever nears the 120s abort.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { MenuSnapshot } from "@/lib/content/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { FOOD_PAIRING_KNOWLEDGE } from "@/lib/skills/food-pairing/knowledge"

const KNOWLEDGE_VERSION = "food-pairing@v2"

// ── The food-pairing archetypes (stable keys — the click-feedback sub-domain the
//    rollup can learn by, mirroring the exemplars' *_ARCHETYPES exports).
//    Defined in the knowledge playbook. ──
export const FOOD_PAIRING_ARCHETYPES = [
  "weather_match_feature",
  "seasonal_swap",
  "signature_spotlight",
  "add_on_merchandise",
  "obvious_pairing",
] as const
export type FoodPairingArchetype = (typeof FOOD_PAIRING_ARCHETYPES)[number]

// ── Signal families (verified table above). Menu-feature types are matched EXACTLY
//    (a Set, not a prefix) so the two price rows are STRUCTURALLY excluded —
//    positioning@v4's territory; food-pairing features a dish, it never reprices.
//    The weather cues time a feature and judge the season. ──
const MENU_FEATURE_TYPES = new Set([
  "menu.signature_item_missing",
  "menu.category_gap",
  "menu.menu_change_detected",
  "menu.promo_signal_detected",
])

// Weather cues that TIME a feature (both LIVE, lib/insights/weather-context.ts):
// visual.weather_patio (a pleasant patio break -> light/outdoor-friendly items;
// SHARED with local-demand@v2) and traffic.weather_suppression (a severe/cold
// stretch -> warm comfort / delivery-friendly items). Both are info-grade by
// construction (see the severity fact above).
const WEATHER_CUE_TYPES = new Set(["visual.weather_patio", "traffic.weather_suppression"])

function isMenuFeatureSignal(t: string): boolean {
  // Base-type resolution so a `type:key` evidence ref (e.g.
  // "menu.menu_change_detected:delta") still matches its rule.
  return MENU_FEATURE_TYPES.has(t.split(":")[0])
}
function isWeatherCueSignal(t: string): boolean {
  return WEATHER_CUE_TYPES.has(t.split(":")[0])
}
export function isFoodPairingSignal(t: string): boolean {
  return isMenuFeatureSignal(t) || isWeatherCueSignal(t)
}

// ── Template kill-list (the analogue of the exemplars' TEMPLATE_PENALTY_PATTERNS).
//    Two classes die here:
//    (1) generic feature/special advice — the sameness failure mode ("feature your
//        best dish", "promote a special", "add a new item", "run a special") — a
//        real v2 play NAMES the dish, the daypart, and the week ("feature the
//        braised short rib at dinner while this cold snap holds" is the bar);
//    (2) every canned rec string the menu/weather rules embed in their own
//        `recommendations`, which the model reads in its input and must never
//        parrot ("Consider adding ..." from category-gap + promo rules, "Explore
//        adding popular competitor items" from signature-item, "Update your online
//        presence" from menu-change, "Highlight outdoor dining options" from the
//        patio rule, "Focus on delivery and indoor experience" from the
//        suppression rule — every one a literal string in the generating code).
//    NOTE: v1.1's floor titles ("Put your standout item front and center" /
//    "Feature the dish that fits this week's weather") are REPLACED by v2's floor
//    and the generic ones are killed here; the retained-copy floor titles are
//    dish/daypart-anchored and survive their own gates. ──
const TEMPLATE_PENALTY_PATTERNS = [
  /put your standout item front and center/i, // v1.1's literal floor title #1 (replaced)
  /feature the dish that fits this week'?s weather/i, // v1.1's literal floor title #2 (replaced)
  // the generic feature/special class — a real play names the item, daypart, and week:
  /\bfeature (?:your |the )?(?:best|top|signature|standout|popular|favorite) (?:dish|item|seller)\b/i,
  /\bpromote (?:a |your )?(?:special|specials|new item|menu item|best seller)\b/i,
  /\b(?:run|add|create|launch|introduce|offer) (?:a |an |some )?(?:new )?special\b/i,
  /\b(?:add|introduce|create) (?:a |an )?new (?:dish|item|menu item)\b/i,
  /\bpush your (?:best|top|signature) (?:dish|item|seller)\b/i,
  /\bupdate your menu\b/i, // vague menu-churn advice; a feature is not a menu edit
  // the canned rec strings embedded in the generating rules' own recommendations:
  /\bconsider adding\b/i, // category-gap + promo rules' canned rec titles
  /\bexplore adding popular competitor items\b/i, // signature-item rule's canned rec
  /\bupdate your online presence\b/i, // menu-change rule's canned rec
  /\bhighlight outdoor dining options\b/i, // patio rule's canned rec
  /\bfocus on delivery and indoor experience\b/i, // suppression rule's canned rec
]

/** True when a play's user-facing text reads as generic feature/special advice or a
 *  parroted canned rule recommendation. */
export function isTemplateAdvice(text: string): boolean {
  return TEMPLATE_PENALTY_PATTERNS.some((re) => re.test(text))
}

/** Compact, NUMBER-FREE menu view: category -> item names (+ tags). Prices and
 *  descriptions are dropped on purpose — names guide WHICH item to feature; a raw
 *  menu price is not grounded evidence and must never be quoted as if it were.
 *  Capped for token discipline. (v2: caps tightened from 8x12 to 6x8 items and
 *  tags to 3. The model only needs enough of the menu to pick ONE real dish to
 *  feature — names+tags for ~48 items is ample — and a fat menu at 8x12 pushed the
 *  worst-case built prompt to ~43k, into the silent-timeout zone. 6x8 lands it in
 *  the ~33-35k band the mastered siblings run at medium effort. Guarded by the
 *  prompt-size regression test.) */
function summarizeMenu(menu: MenuSnapshot | null | undefined) {
  if (!menu || menu.categories.length === 0) return null
  return menu.categories.slice(0, 6).map((c) => ({
    category: c.name,
    items: c.items.slice(0, 8).map((it) => ({
      name: it.name,
      tags: it.tags?.length ? it.tags.slice(0, 3) : undefined,
    })),
  }))
}

/** Capped, filtered slice of grounded rule outputs (token-budget discipline). */
function take(d: Dossier, pred: (t: string) => boolean, cap: number) {
  return d.ruleOutputs.filter((i) => pred(i.insight_type)).slice(0, cap)
}

// ── Input selection (what the model reasons over) ──────────────────────────────────
function selectInput(d: Dossier) {
  return {
    // HOME-TURF GROUNDED SIGNALS by family (each capped; these are the citable refs).
    menuSignals: take(d, isMenuFeatureSignal, 6),
    weatherCueSignals: take(d, isWeatherCueSignal, 3),
    // Raw menu (names + tags only) so the model features a dish that actually exists.
    menu: summarizeMenu(d.location.menu),
    // The forecast is reasoning CONTEXT for timing the feature + judging seasonality;
    // it is not a citable ref. Trimmed to the near horizon.
    weatherForecast: d.demandCalendar.weather.slice(0, 4),
    hoursServed: d.profile.hours ?? null,
    // Segment read (drives concept-fit — see FIT CHECK FIRST + SEGMENT AWARENESS in
    // the playbook). hasPatio rides here explicitly: a patio-anchored feature gates
    // on it (the patio signal's photo evidence is a competitor-photo proxy). The
    // dayparts + hours guard which windows a feature may anchor to.
    segment: {
      tier: d.tier.tier,
      maxLocations: d.tier.maxLocations,
      cuisine: d.profile.attributes.cuisine ?? null,
      priceTier: d.profile.attributes.priceTier ?? null,
      serviceModel: d.profile.attributes.serviceModel ?? null,
      hasPatio: d.profile.attributes.hasPatio ?? null,
      dayparts: d.profile.attributes.dayparts ?? [],
    },
  }
}

// ── Parse: shared coercion + the food-pairing quality gates ─────────────────────────
//  (1) every play grounds on >=1 food-pairing-family signal (run.ts also
//      ground-filters against allowedEvidenceRefs; this enforces the DOMAIN so a
//      play can't ride solely on an excluded price ref or a borrowed one);
//  (2) generic feature/special advice and parroted canned recs are SUPPRESSED (the
//      kill-list above);
//  (3) stance backstop: keep the model's deliberate stance; when unset, stamp "fix"
//      if any cited food-pairing ref resolves to a warning/critical rule output,
//      else "capture". "maintain" is only ever model-chosen (scoring caps its
//      impact — never weaken that by inferring it; a feature is a this-week move,
//      not a standing habit). In practice this skill's signals are all info-grade,
//      so the backstop defaults to "capture" — but the resolution is kept for
//      forward-compat if a menu/weather rule ever earns a severity ladder.
function parse(raw: unknown, d: Dossier): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "food-pairing",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "capitalize",
    defaultOwner: "kitchen",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  const severityByType = new Map(d.ruleOutputs.map((i) => [i.insight_type, i.severity] as const))
  return coerced
    .filter((p) => {
      if (!p.evidenceRefs.some(isFoodPairingSignal)) return false // (1) domain grounding
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      if (isTemplateAdvice(text)) return false // (2) kill generic / parroted output
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
// AT MOST 2 PLAYS, emitted ONLY when a real menu or weather-cue signal exists to
// ground them (no signal, no feature). The copy BRANCHES on the signal type so a
// menu-grounded play does NOT claim a weather rationale the evidence never
// established, and vice-versa (honesty: never imply grounding the play lacks).
//
// SEVERITY IS NOT THE GATE HERE (the argued deviation, see the header + rationale):
// all six of this skill's signals are info-grade by construction, so a
// warning/critical gate would silence the skill entirely and take patio-weather
// red. The honesty is carried by the DOMAIN gate (real signal only), the generators'
// OWN gates (the weather signal is notability-gated in code — it fires only on a
// pleasant break, never routine heat), and a CONCEPT gate on the patio branch: a
// patio-anchored weather feature only fires when the profile's OWN hasPatio flag is
// set, because visual.weather_patio's photo evidence is a competitor-photo proxy
// (verified in the weather pipeline; the same gate local-demand@v2's patio floor
// uses). When the patio flag is absent, the patio signal still grounds a
// weather-fit feature — just one that doesn't claim a patio.
//
// GOLDEN CONSTRAINT: patio-weather's only rule output is visual.weather_patio
// (info) with hasPatio: true; this floor fires the weather-match feature there,
// keeping the golden green (local-demand@v2 also fires — the deliberate shared
// read). quiet-week's only signal is seo_organic_visibility_up (off-domain) -> [].
function fallback(d: Dossier): EnrichedRecommendation[] {
  const signals = d.ruleOutputs.filter((i) => isFoodPairingSignal(i.insight_type)).slice(0, 2)
  const hasPatio = d.profile.attributes.hasPatio === true
  return signals.map((ins) => {
    const isMenu = isMenuFeatureSignal(ins.insight_type)
    const isPatio = ins.insight_type.split(":")[0] === "visual.weather_patio"
    // Copy branches three ways so the rationale never over-claims its grounding:
    //  - menu signal        -> feature the standout, no weather claim;
    //  - patio weather + patio confirmed -> the outdoor-friendly feature;
    //  - any other weather cue (or patio without the flag) -> the weather-fit
    //    feature with no patio claim.
    const title = isMenu
      ? "Put one dish you already serve out front as this week's pick"
      : isPatio && hasPatio
        ? "Put a light plate from your menu out front for the patio weather"
        : "Put the dish on your menu that fits this weather out front"
    const rationale = isMenu
      ? `Grounded in ${ins.title}. Pick the item this points to, feature it on a daypart you actually serve, and make it the easy answer to "what should I get". Keep it to one clear pick, not a menu change.`
      : isPatio && hasPatio
        ? `Grounded in ${ins.title}. A pleasant break like this fills outdoor seats first, so put a light, fresh, easy-to-share plate you already serve out front while it holds. One clear pick on a daypart you serve, not a new dish.`
        : `Grounded in ${ins.title}. Match the plate to this weather: put the item already on your menu that suits it out front, on a daypart you serve. One clear pick, not a menu change.`
    return {
      title,
      rationale,
      skillId: "food-pairing",
      ownerRole: "kitchen" as const,
      kind: "capitalize" as const,
      stance: "capture" as const, // a fit-the-week feature seizes a this-week opening
      recipe: [
        {
          channel: "menu feature / specials board + your live channels",
          platforms: [],
          audience: "guests deciding what to order this week",
          window: { note: isMenu ? "this week" : "this week, while the weather holds" },
          creativeDirection:
            "on your phone, take one clear photo of the featured dish as it leaves the kitchen, so your staff and your channels can show people what to order",
          dependencies: [
            "the item is already on your menu and the kitchen can make it at volume",
            "a daypart you actually serve to anchor it to",
          ],
        },
      ],
      confidence: "medium" as const,
      leverage: {
        label: "medium" as const,
        basisInternal: "fallback play; menu-fit feature sized ordinally; no margin, food-cost, or ticket-time figures available",
      },
      evidenceRefs: [ins.insight_type],
      knowledgeVersion: KNOWLEDGE_VERSION,
    }
  })
}

export const foodPairingSkill: ProducerSkill = {
  id: "food-pairing",
  displayName: "Food-pairing & menu expert (the kitchen)",
  ownerRole: "kitchen",
  kind: "capitalize",
  category: "menu",
  tier: "reasoning",
  // temperature 0.5 kept from v1.1: features need some creative dish-picking, but
  // they sit against real menus, dayparts, and weather where drift is costly (the
  // same setting local-demand@v2 uses — between marketing's 0.6 and operations'/
  // positioning's 0.4). Boldness comes from the playbook, not heat.
  temperature: 0.5,
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: FOOD_PAIRING_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(foodPairingSkill, d, selectInput(d), k),
  parse,
  fallback,
  // FUNDAMENTALS-ONLY by design (Bryan, 2026-06-26; preserved from v1.1): the kitchen
  // runs on its authored fundamentals (weather/season/daypart + obvious-pairing
  // guardrails), NOT an external FOOD-trend feed — those sources were scrape-hostile
  // and, more importantly, food trends are not where the leverage is for our target
  // operators ("trends" belong to a FUTURE engagement/social expert: SOCIAL trends,
  // not food). So no `external` stream. The skill still learns from CLICK feedback
  // (thumbs/Keep -> rollup multiplier, now per-archetype via FOOD_PAIRING_ARCHETYPES)
  // + ASK demand — usage, not trends.
  learning: {
    streams: ["click", "ask"],
    playTypeLeadDomain: "menu",
    acceptedLearningKinds: ["editorial"],
  },
}
