// ---------------------------------------------------------------------------
// Positioning & Pricing skill — REWRITTEN (mastery-program v2, 2026-07-03) from
// a thin "menu/value moves" interpreter into the master of the PRICE-VALUE
// EQUATION. Fifth skill in the one-at-a-time mastery program; marketing@v2,
// reputation@v2, operations@v2 and local-demand@v2 (all on main) are the proven
// templates.
//
// VERSION STRING: positioning@v4, not @v2. This skill's knowledgeVersion already
// consumed "positioning@v2" (P4 price-mismatch corroboration, 2026-06-19) and
// "positioning@v3" (PV vision read) — plays persisted under both live in
// brief_plays, and the feedback rollup keys on knowledgeVersion. Reusing @v2
// would conflate the master rewrite with P4-era plays; @v4 keeps the history
// monotonic. (The PROGRAM generation is still "v2": the mastery rewrite.)
//
// WHY: v1's playbook was 57 lines and its floor shipped two canned titles
// ("Answer the undercut with quality, not a discount" / "Add a value entry
// point, do not start a price war") off ANY matching signal at ANY severity —
// info-grade name-matching rows included. The skill owning the boldest play
// class (price moves, menu structure, value framing) had no price-move
// mechanics, no menu-surgery craft, no claim construction, and no folklore
// discipline. The canned pair AND the severity-blind floor die here.
//
// VERIFIED SIGNAL REALITY (read from lib/content/insights.ts,
// lib/insights/photo-insights.ts, lib/seo/insights.ts and the pipelines that
// call them — not assumed from the type names):
//   menu.price_positioning_shift   own-vs-comp  info/warning(>=30%)  PR #69 gated: >=6 comparable
//                                               meal items EACH side (add-ons excluded), >=15% gap,
//                                               confidence COMPUTED from sample depth; the
//                                               you-price-above direction is re-framed by own-review
//                                               corroboration (evidence.corroboration strong/weak/
//                                               unknown; uncorroborated rows are FORCED to info).
//                                               So warning-grade means: headroom (they price >=30%
//                                               above you), or you-above WITH guests flagging it.
//   menu.catering_pricing_gap     own-vs-comp  info/warning(>=25%)  same PR #69 gates, >=10% gap
//   menu.category_gap             comp-vs-own  info ALWAYS          name-level category diff
//   menu.signature_item_missing   comp-vs-own  info ALWAYS          NAME-set diff (>=3 items) —
//                                                                   differently-worded ≠ missing
//   menu.promo_signal_detected    competitor   info ALWAYS          keyword present there, not here
//   menu.menu_change_detected     OWN          info ALWAYS          scrape item-count delta >=3 —
//                                                                   the PUBLIC surface, not the kitchen
//   content.conversion_feature_gap comp-vs-own info/warning(>=2)    site features (reservations,
//                                                                   ordering, private dining, catering)
//   content.delivery_platform_gap comp-vs-own  info ALWAYS          platform presence diff
//   photo.price_change            competitor   warning              a price OCR'd from ONE new photo —
//                                                                   corroboration-grade, never primary
// v1's third intake prefix, "seo_competitor", is LIVE but OFF-DOMAIN: the four
// seo_competitor_* types are search-visibility conquest, which marketing@v2 now
// explicitly claims (its isCompetitorMoveSignal reads seo_*). v2 CEDES the
// prefix deliberately — positioning reads prices and menus, not rankings. The
// photo.price_change claim is NEW and deliberately SHARED with marketing (their
// read: conquest campaign; ours: the comparison set moving — the program's
// standing same-evidence-different-play pattern).
//
// THE CENTRAL LAW (menu-price postmortem, PR #69): scraped menus are unstable
// 3-5 item samples; comparisons were apples-to-oranges with hardcoded
// confidence:high. The generating code now gates on comparable sample size with
// computed confidence — so the ONLY price comparisons in this skill's universe
// are rows that already passed those gates, and the playbook's SAMPLE HUMILITY
// DOCTRINE forbids re-deriving comparisons from the raw menu reads or repeating
// menu-read numbers in play text.
//
// QUALITY MECHANISM (mirrors the four exemplars):
//  (1) parse() SUPPRESSES any play that doesn't ground on a positioning-family
//      signal (and the ceded seo_competitor_* refs are OUTSIDE that family, so
//      a play riding a rival's ranking move dies at the gate);
//  (2) a template kill-list drops v1's literal floor titles, naked whole-menu
//      price advice, price-war moves, fee/surcharge proposals, quiet portion
//      cuts, "add a value menu"-class genericisms, AND the canned phrasings the
//      menu/content rules embed in their own recommendations ("Evaluate a price
//      increase", "Consider adding ...", "Update your online presence", ...) so
//      the model can never parrot its own input;
//  (3) confidence is calibrated in the playbook, never hardcoded (the PR #69
//      postmortem: hardcoded confidence is banned);
//  (4) stance is stamped DELIBERATELY per archetype in the playbook, and
//      parse() backstops an unset stance from the cited signals' severity (fix
//      on warning/critical, capture otherwise; maintain only ever model-chosen —
//      pricing is a decision, not a habit).
//
// HONEST FLOOR (severity-gated, at most 2 plays):
//  - ONE price-position play on the strongest warning/critical gated price row
//    (price_positioning_shift > catering_pricing_gap; critical > warning) — the
//    GOLDEN CONSTRAINT: the competitive-week fixture carries a warning-grade
//    menu.price_positioning_shift and positioning must fire grounded on it.
//    Tier-aware branch (premium/upscale/fine -> make-the-premium-legible;
//    value/mid-market -> one entry item in a non-core lane; UNKNOWN tier ->
//    the story play, never a cheap plate for a concept we can't see — an
//    honesty upgrade over v1, whose unknown-tier default was the value plate).
//  - ONE conversion-parity play on a warning-grade content.conversion_feature_gap
//    (warning = >=2 missing features by construction, verified).
//  - Everything else stays silent: category_gap / signature_item_missing /
//    promo_signal / menu_change / delivery_platform_gap are info BY CONSTRUCTION
//    (verified above) and are name-matching or scrape-surface reads the canned
//    floor cannot frame honestly; photo.price_change is warning-grade but
//    single-photo corroboration — model-path nuance, never a canned trigger.
//    A quiet week stays an honest quiet brief.
//
// TOKEN BUDGET: v1 passed WHOLE MenuSnapshot objects for the own location and
// every competitor — a large parsed menu is hundreds of items with descriptions
// (guerrilla precedent: a ~40k-char prompt at medium effort silently timed out
// into the fallback). v2 passes a DISTILLED menu read per entity: structure,
// ladders, comparable-price bands (via the same comparableItems() lens the
// price rules use), scrape-confidence metadata — shape, not the raw menu.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { EntityVisualProfile } from "@/lib/social/types"
import type { MenuCategory, MenuItem, MenuSnapshot, MenuType } from "@/lib/content/types"
import { comparableItems } from "@/lib/content/insights"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { selectAdjacentSignals } from "@/lib/skills/domain-map"
import { POSITIONING_KNOWLEDGE } from "@/lib/skills/positioning/knowledge"

const KNOWLEDGE_VERSION = "positioning@v4"

// ── The positioning archetypes (stable keys — the click-feedback sub-domain the
//    rollup can learn by, mirroring the four exemplars' *_ARCHETYPES exports).
//    Defined in the knowledge playbook. ──
export const POSITIONING_ARCHETYPES = [
  "evidence_gated_price_move",
  "value_story_rebuild",
  "premium_cue_repositioning",
  "menu_structure_surgery",
  "value_entry_anchor",
  "only_one_who_claim",
  "conversion_parity_fix",
  "delivery_price_stance",
] as const
export type PositioningArchetype = (typeof POSITIONING_ARCHETYPES)[number]

// ── Signal families (redesigned from the verified table above). Prefix-matched
//    against insight_type; the same predicates gate parse(), so intake and
//    grounding stay in lockstep.
//    THE CESSION: v1's "seo_competitor" prefix is DROPPED — those four types are
//    search-visibility conquest, which marketing@v2's competitor-move family
//    explicitly claims (verified: its isCompetitorMoveSignal reads seo_*).
//    DOMAIN_PREFIXES.positioning in domain-map.ts should be updated to
//    ["menu.", "content.", "photo.price_change"] for lockstep hygiene (no
//    functional change: no skill lists positioning as adjacent).
//    THE NEW CLAIM: photo.price_change (a rival's posted price OCR'd from one
//    photo) — deliberately SHARED with marketing (their conquest lane reads all
//    of photo.*); our read is the comparison set moving, corroboration-grade. ──
function isPriceGapSignal(t: string): boolean {
  // The two PR #69-gated price rows — the only price comparisons that survived
  // the comparable-sample gates, and the only ones a price play may lean on.
  return t.startsWith("menu.price_positioning_shift") || t.startsWith("menu.catering_pricing_gap")
}
function isMenuShapeSignal(t: string): boolean {
  // The rest of the menu.* family: category/name gaps, promo keywords, the own
  // public-menu change row. Kept as a catch-all so a future menu.* rule lands in
  // the positioning lane by default (the local-demand "weather" precedent).
  return t.startsWith("menu.") && !isPriceGapSignal(t)
}
function isConversionSignal(t: string): boolean {
  // content.conversion_feature_gap + content.delivery_platform_gap (verified:
  // the only content.* types in prod), plus future content.* by default.
  return t.startsWith("content.")
}
function isRivalPriceMoveSignal(t: string): boolean {
  // ONLY the price OCR row — never the rest of photo.* (new-content/promotion
  // diffs are marketing's conquest material with no price-value read).
  return t.startsWith("photo.price_change")
}
export function isPositioningSignal(t: string): boolean {
  return t.startsWith("menu.") || isConversionSignal(t) || isRivalPriceMoveSignal(t)
}

// ── Template kill-list (the analogue of the exemplars' TEMPLATE_PENALTY_PATTERNS).
//    Four classes die here:
//    (1) v1's literal floor output — both canned titles and the canned rationale
//        line ("do not start a price war");
//    (2) the naked-price-advice class: whole-menu "raise/lower your prices"
//        phrasings (a master play names the item and the section), price-war and
//        match-their-price moves, fee/surcharge proposals (the highest-backlash
//        lever in the research; costs fold into the printed price), and quiet
//        portion cuts (detected shrinkflation is a trust break, never advice);
//    (3) "add a value menu"-class genericisms;
//    (4) the canned phrasings the menu/content rules embed in their own
//        recommendations, which the model reads in its input and must never
//        parrot ("Evaluate a price increase" / "Review your pricing strategy" /
//        "Check pricing against real feedback" / "Lead with your value, not a
//        lower price" / "Consider adding ..." / "Explore adding popular
//        competitor items" / "Update your online presence" / "Consider joining
//        ..." / "leaving revenue on the table" / "Compare pricing with your
//        menu" — every one is a literal string in lib/content/insights.ts or
//        lib/insights/photo-insights.ts). ──
const TEMPLATE_PENALTY_PATTERNS = [
  /answer the undercut with quality/i, // v1's literal floor title #1
  /add a value entry point/i, // v1's literal floor title #2
  /do not start a price war/i, // v1's canned rationale line
  /\bprice war\b/i, // the move is banned and so is the cliché
  /\bmatch (?:their|the competitor'?s?|a rival'?s?) (?:price|prices|number)\b/i,
  /\bundercut (?:them|their price|the competition)\b/i,
  /\bcompete on price\b/i,
  // naked whole-menu price advice — a real play names the item and the section
  // ("raise the price of the brisket" survives; "raise your prices" dies):
  /\b(?:raise|raises|raised|raising|increase|increases|increased|increasing|lower|lowers|lowered|lowering|cut|cuts|cutting|drop|drops|dropped|dropping|reduce|reduces|reduced|reducing)\s+(?:your\s+|all\s+|the\s+|menu\s+)*prices\b/i,
  /\breview your pricing strategy\b/i, // price rule's canned rec
  /\bevaluate a price increase\b/i, // price rule's canned rec
  /\bensure your value proposition justifies\b/i, // price rule's canned rationale
  /\bcheck pricing against real feedback\b/i, // corroborated variant's canned rec
  /\blead with your value, not a lower price\b/i, // uncorroborated variant's canned rec
  /\bmake the premium obvious\b/i, // same source
  /\bconsider adding\b/i, // category-gap + promo rules' canned recs
  /\bexplore adding popular competitor items\b/i, // signature-item rule's canned rec
  /\bupdate your online presence\b/i, // menu-change rule's canned rec
  /\badd .{0,40} to your website\b/i, // conversion-gap rule's canned rec shape
  /\bconsider joining\b/i, // delivery-gap rule's canned rec
  /\bleaving revenue on the table\b/i, // catering rule's canned rationale
  /\breview catering price opportunity\b/i, // catering rule's canned rec
  /\baudit catering pricing\b/i, // same source
  /\bcompare pricing with your menu\b/i, // photo price-change rule's canned rec
  /\b(?:add|create|launch|introduce|roll out) an? .{0,16}value (?:menu|tier)\b/i, // the genericism class
  /\b(?:add|introduce|implement|charge) (?:a |an )?(?:small |new |extra |automatic |service |living[- ]wage |inflation |credit[- ]card )*(?:fee|surcharge)\b/i,
  /\b(?:shrink|reduce|trim|cut) (?:the |your )?portions?\b/i, // quiet shrinkflation is never advice
]

/** True when a play's user-facing text reads as v1's canned floor, naked/whole-menu
 *  price advice, a price-war or fee move, or a parroted canned rule recommendation. */
export function isTemplateAdvice(text: string): boolean {
  return TEMPLATE_PENALTY_PATTERNS.some((re) => re.test(text))
}

// ── The vision asset (KEPT from v1, extended) ───────────────────────────────────────
/**
 * Distil the Gemini Vision profile (EntityVisualProfile) into a COMPACT positioning read —
 * a synthesis, never the raw profile. The raw profile carries a `postAnalyses` array (one
 * entry per analyzed photo) that would blow the prompt's token budget and bury the signal;
 * we keep only the aggregate scores + the dominant content the camera is actually pointed
 * at + the atmosphere/quality cues that tell the model what the place LOOKS like.
 * PV (vision → positioning): premium cues (polished plating, a consistent on-brand look, a
 * full room) are positioning PROOF POINTS — they make a higher price feel earned.
 * v2 EXTENSIONS (all from verified EntityVisualProfile fields, all level-words or existing
 * aggregates, all null-safe):
 *  - platingRead / portionRead: the DOMINANT plating-quality and portion-appeal level word
 *    across the analyzed food shots (portion generosity is value-perception evidence; small
 *    portions next to price complaints is the shrinkflation-risk read);
 *  - promotionalContentPct: a deal-heavy feed is discount positioning whether the operator
 *    chose it or not — a premium claim on a coupon-book feed undermines its own check.
 * Returns null when there is no usable vision data so the prompt is byte-identical to the
 * no-vision behavior (many orgs have no Gemini profile yet). */
export function visualPositioningRead(v: EntityVisualProfile | null | undefined) {
  if (!v) return null
  // contentMix is a {category: share} map; surface only what the camera points at most.
  const topContent = Object.entries(v.contentMix ?? {})
    .filter(([, share]) => typeof share === "number" && share > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([category, share]) => ({ category, share: Math.round(share * 100) / 100 }))
  // Atmosphere read from the analyzed posts — the room/energy cues, deduped & capped.
  const atmosphere = Array.from(
    new Set(
      (v.postAnalyses ?? [])
        .map((p) => p.analysis?.atmosphereSignals)
        .flatMap((a): string[] =>
          a ? [a.crowdLevel, a.energy].filter((x): x is typeof x => !!x && x !== "n/a") : [],
        ),
    ),
  ).slice(0, 4)
  // Dominant level word across analyzed food shots (n/a excluded); null when none qualify.
  const dominant = (labels: string[]): string | null => {
    const counts = new Map<string, number>()
    for (const l of labels) {
      if (!l || l === "n/a") continue
      counts.set(l, (counts.get(l) ?? 0) + 1)
    }
    let best: string | null = null
    let bestN = 0
    for (const [label, n] of counts) if (n > bestN) [best, bestN] = [label, n]
    return best
  }
  const food = (v.postAnalyses ?? [])
    .map((p) => p.analysis?.foodPresentation)
    .filter((f): f is NonNullable<typeof f> => !!f)
  const platingRead = dominant(food.map((f) => f.platingQuality))
  const portionRead = dominant(food.map((f) => f.portionAppeal))
  const hasSignal =
    topContent.length > 0 ||
    atmosphere.length > 0 ||
    platingRead != null ||
    portionRead != null ||
    [v.avgVisualQualityScore, v.foodPresentationScore, v.brandConsistencyScore, v.crowdSignalScore].some(
      (s) => typeof s === "number" && s > 0,
    )
  if (!hasSignal) return null
  return {
    // 0–100 aggregate scores from the photo analysis — quantified "what it looks like".
    visualQualityScore: v.avgVisualQualityScore,
    foodPresentationScore: v.foodPresentationScore,
    brandConsistencyScore: v.brandConsistencyScore,
    crowdSignalScore: v.crowdSignalScore,
    professionalContentPct: v.professionalContentPct,
    // NEW: the deal-heaviness of the feed — discount positioning shows up here first.
    promotionalContentPct: v.promotionalContentPct,
    topContent,
    atmosphere,
    // NEW: plating/portion level words — the premium-cue and value-perception reads.
    ...(platingRead ? { platingRead } : {}),
    ...(portionRead ? { portionRead } : {}),
  }
}

// ── The menu read (NEW): a distilled, sample-honest picture of a scraped menu ────────
/** Distil a MenuSnapshot into SHAPE the model can reason over without the raw menu:
 *  per menu-type bucket, the category list, the comparable-meal price band (the SAME
 *  comparableItems() lens the PR #69-gated price rules use), and the top/bottom of the
 *  price ladder (the anchor and the way in). Scrape metadata (parse confidence, item
 *  count, capture date) rides along so the model can weigh staleness — the playbook's
 *  humility doctrine forbids quoting any of these numbers in play text. Null-safe:
 *  no menu → null, and the input key is omitted (byte-identical to a menu-less prompt). */
export function menuRead(m: MenuSnapshot | null | undefined) {
  if (!m?.categories?.length) return null
  const byType = new Map<MenuType, MenuCategory[]>()
  for (const c of m.categories) {
    const t = c.menuType ?? "dine_in"
    byType.set(t, [...(byType.get(t) ?? []), c])
  }
  const buckets = [...byType.entries()].slice(0, 3).map(([menuType, cats]) => {
    const comparable = comparableItems(cats).slice().sort((a, b) => a - b)
    const priced = cats
      .flatMap((c) => c.items)
      .filter((i): i is MenuItem & { priceValue: number } => typeof i.priceValue === "number" && i.priceValue > 0)
      .sort((a, b) => b.priceValue - a.priceValue)
    return {
      menuType,
      categories: cats.map((c) => c.name).slice(0, 12),
      pricedItemCount: priced.length,
      comparableMealCount: comparable.length,
      comparableMealBand: comparable.length
        ? {
            low: comparable[0],
            median: comparable[Math.floor(comparable.length / 2)],
            high: comparable[comparable.length - 1],
          }
        : null,
      // The ladder's ends: the section-topping anchor candidates and the cheapest way in.
      highestPriced: priced.slice(0, 3).map((i) => ({ name: i.name, price: i.priceValue })),
      lowestPriced: priced
        .slice(-3)
        .reverse()
        .map((i) => ({ name: i.name, price: i.priceValue })),
    }
  })
  return {
    capturedAt: m.capturedAt ?? null,
    scrapeConfidence: m.parseMeta?.confidence ?? null,
    itemsSeenInScrape: m.parseMeta?.itemsTotal ?? null,
    scrapeNotes: (m.parseMeta?.notes ?? []).slice(0, 2),
    buckets,
  }
}

/** Capped, prefix-filtered slice of grounded rule outputs (token-budget discipline). */
function take(d: Dossier, pred: (t: string) => boolean, cap: number) {
  return d.ruleOutputs.filter((i) => pred(i.insight_type)).slice(0, cap)
}

// ── Input selection (what the model reasons over) ──────────────────────────────────
/** Differential option (b): positioning's reuse hash. Excludes ONLY `reviewThemes` — prose from
 *  the daily sentiment LLM run, which rewrites itself over identical reviews (measured: this skill
 *  reused 0/46 slots in the 07-09→07-13 week purely from that churn). Guest-voice SUBSTANCE still
 *  triggers re-runs via the citable rule-output signals (conversionSignals/adjacentSignals hash on
 *  real review data). reviewThemes still rides in the prompt via selectInput. */
function selectStableInput(d: Dossier) {
  const { reviewThemes, ...stable } = selectInput(d)
  void reviewThemes // volatile context — prompt-only, never hashed
  return stable
}

function selectInput(d: Dossier) {
  // PV: positioning reads the venue's LOOK. Distilled (token-budget-aware), and omitted
  // entirely when absent so no-vision orgs see the exact no-vision prompt.
  const visualRead = visualPositioningRead(d.location.visual)
  // P5 adjacency unchanged: the GROUNDED reputation rule-outputs (rating/review
  // insight_types) — a citeable counterpart to the prose reviewThemes, so a price move
  // can lean on a real ref when guests actually flag value. Omitted when none.
  const adjacentSignals = selectAdjacentSignals(d, "positioning")
  // Guest voice as reasoning context: top themes with ONE verbatim example each — the
  // corroboration layer (price complaints license price scrutiny; worth-it praise is
  // premium-cue proof; silence on price is itself a signal). Trimmed hard.
  const reviewThemes = (d.location.reviews?.themes ?? [])
    .slice()
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 6)
    .map((t) => ({ theme: t.theme, sentiment: t.sentiment, mentions: t.mentions, example: t.examples[0] ?? null }))
  return {
    // HOME-TURF GROUNDED SIGNALS by family (each capped; these are the citable refs).
    priceGapSignals: take(d, isPriceGapSignal, 4),
    menuShapeSignals: take(d, isMenuShapeSignal, 6),
    conversionSignals: take(d, isConversionSignal, 3),
    rivalPriceMoves: take(d, isRivalPriceMoveSignal, 2),
    // MENU SHAPE (context, not citable): the distilled own read + one per rival, built
    // with the SAME comparability lens the price rules use. v1 passed whole MenuSnapshot
    // objects — a token-budget hazard and a false "this is the complete menu" framing.
    ownMenuRead: menuRead(d.location.menu),
    ownFeatures: d.location.features ?? null,
    competitors: d.competitors.slice(0, 5).map((c) => ({
      name: c.name,
      menuRead: menuRead(c.menu),
      features: c.features ?? null,
    })),
    ...(reviewThemes.length ? { reviewThemes } : {}),
    // What the place LOOKS like (Gemini Vision). Present only when there is real vision
    // data — see WHAT THE PLACE LOOKS LIKE in the playbook.
    ...(visualRead ? { visualProfile: visualRead } : {}),
    // Segment read (drives which archetypes fit — see SEGMENT AWARENESS in the playbook).
    segment: {
      tier: d.tier.tier,
      maxLocations: d.tier.maxLocations,
      seats: d.profile.capability.seats ?? null,
      serviceModel: d.profile.attributes.serviceModel ?? null,
      priceTier: d.profile.attributes.priceTier ?? null,
    },
    ...(adjacentSignals.length ? { adjacentSignals } : {}),
  }
}

// ── Parse: shared coercion + the positioning quality gates ───────────────────────────
//  (1) every play grounds on ≥1 positioning-family signal (run.ts also ground-filters
//      against allowedEvidenceRefs; this enforces the DOMAIN so a play can't ride
//      solely on a borrowed reputation ref — or on a ceded seo_competitor_* ref);
//  (2) v1's canned floor class, naked price advice, price-war/fee moves, and parroted
//      canned rule recs are SUPPRESSED (the kill-list above);
//  (3) stance backstop: keep the model's deliberate stance; when unset, stamp "fix" if
//      any cited positioning ref resolves to a warning/critical rule output (a
//      warning-grade price row is a live price-value mismatch by construction), else
//      "capture". "maintain" is only ever model-chosen (scoring caps its impact —
//      never weaken that by inferring it; pricing is a decision, not a habit).
function parse(raw: unknown, d: Dossier): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "positioning",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "positioning",
    defaultOwner: "owner",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  const severityByType = new Map(d.ruleOutputs.map((i) => [i.insight_type, i.severity] as const))
  return coerced
    .filter((p) => {
      if (!p.evidenceRefs.some(isPositioningSignal)) return false // (1) domain grounding
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      if (isTemplateAdvice(text)) return false // (2) kill the canned/naked-price classes
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
// AT MOST 2 PLAYS, severity-gated (v1 fired its canned pair off ANY matching signal at
// ANY severity — including info-grade name-matching rows; that defect dies here).
// Two candidate slots in priority order:
//  (a) the strongest warning/critical GATED PRICE row (price_positioning_shift beats
//      catering_pricing_gap; critical beats warning) — the golden-constraint trigger.
//      Warning-grade means the gates already blessed it: either the area prices well
//      above you (headroom) or you price above AND guests corroborate (the
//      corroboration pass forces uncorroborated you-above rows to info — verified).
//      Tier-aware branch: premium/upscale/fine -> make the premium legible; value/
//      mid-market -> one entry item in a non-core lane; UNKNOWN tier -> the story play
//      (never a cheap plate for a concept we can't see; v1 defaulted the other way).
//  (b) a warning-grade conversion feature gap (warning = two or more missing features
//      by construction) -> the parity play, margin-ordered.
// Info-grade menu-shape rows (category/name/promo/menu-change — info BY CONSTRUCTION),
// delivery-platform rows (info), and photo.price_change (warning but single-photo
// corroboration-grade) never manufacture a floor play. A quiet week stays quiet.
// The floor never repeats a row's numbers: the rule rows carry the gated figures; the
// floor speaks in level words only.
const PRICE_ROW_PRIORITY = ["menu.price_positioning_shift", "menu.catering_pricing_gap"] as const

function fallback(d: Dossier): EnrichedRecommendation[] {
  const actionable = (sev: string) => sev === "warning" || sev === "critical"

  // (a) strongest gated price row: critical beats warning; type priority breaks ties.
  const priceCandidates = d.ruleOutputs.filter((i) => isPriceGapSignal(i.insight_type) && actionable(i.severity))
  const price = priceCandidates.sort((a, b) => {
    const sev = (x: (typeof a)) => (x.severity === "critical" ? 0 : 1)
    if (sev(a) !== sev(b)) return sev(a) - sev(b)
    const pri = (x: (typeof a)) => PRICE_ROW_PRIORITY.findIndex((p) => x.insight_type.startsWith(p))
    return pri(a) - pri(b)
  })[0]

  // (b) the conversion gap — warning-grade only (>= 2 missing features by construction).
  const conversion = d.ruleOutputs.find(
    (i) => i.insight_type.startsWith("content.conversion_feature_gap") && actionable(i.severity),
  )

  const out: EnrichedRecommendation[] = []

  if (price) {
    const tier = (d.profile.attributes.priceTier ?? "").toLowerCase()
    const premium = tier.includes("premium") || tier.includes("upscale") || tier.includes("fine")
    const value = tier.includes("value") || tier.includes("mid") || tier.includes("casual") || tier.includes("inexpensive")
    if (!value || premium) {
      // Premium OR unknown tier: the value-story play. Never a cheap plate for a concept
      // the profile can't confirm is a value concept.
      out.push({
        title: "Put the proof behind your price where guests decide",
        rationale: `Grounded in ${price.title}. A price gap only hurts when your number reads as arbitrary. Before touching the check, spend ten minutes in your latest reviews: if guests are not flagging price, this is a story job, not a price job. Name what is sourced, aged, or made in-house on the menu itself, lead your profile with your strongest dish and your fullest hour, and let the gap read as a choice you made. If reviews do flag price, look at the few dishes guests can compare next door, one by one, and leave the rest alone.`,
        skillId: "positioning",
        ownerRole: "owner" as const,
        kind: "positioning" as const,
        stance: "fix" as const, // a warning-grade gated price row is a live price-value mismatch
        recipe: [
          {
            channel: "menu wording + Google Business profile + your own site",
            platforms: [],
            audience: "guests deciding whether the occasion is worth your check",
            window: { note: "this week, before any price change" },
            creativeDirection:
              "on your phone, one photo of your signature dish just as it is served and one of the room at its fullest hour; use the best of each on your profile",
            dependencies: [
              "ten minutes with your latest reviews, checking for price complaints",
              "the menu checked against what you actually serve today",
            ],
          },
        ],
        confidence: "medium" as const,
        leverage: {
          label: "medium" as const,
          basisInternal:
            "fallback play; premium-defense sized ordinally from a warning-grade gated price row, no gap figure repeated",
        },
        evidenceRefs: [price.insight_type],
        knowledgeVersion: KNOWLEDGE_VERSION,
      })
    } else {
      // Confirmed value / mid-market tier: the comparison re-entry play.
      out.push({
        title: "Open one cheap door in a lane your big sellers don't own",
        rationale: `Grounded in ${price.title}. When a nearby rival prices under you, the danger is falling out of the quick comparison, not the gap itself. Add ONE genuinely cheap, easy-to-make item in a lane apart from your best sellers, give it a name people can search and ask for, and pair it with an add-on path so the check grows on its own. Hold every core price where it is. After a few weeks, check the register: if the new item brings new faces, keep it; if it just resells your regulars for less, kill it without ceremony.`,
        skillId: "positioning",
        ownerRole: "owner" as const,
        kind: "positioning" as const,
        stance: "fix" as const,
        recipe: [
          {
            channel: "menu + register + Google Business profile",
            platforms: [],
            audience: "price-checking locals comparing you against the cheaper option",
            window: { note: "before the weekend, then hold for a month" },
            creativeDirection:
              "on your phone, one clear daylight photo of the new item; write its name where walk-ins can see it",
            dependencies: [
              "your register set up to ring the new item on its own",
              "the menu checked against what you actually serve today",
            ],
          },
        ],
        confidence: "medium" as const,
        leverage: {
          label: "medium" as const,
          basisInternal:
            "fallback play; comparison re-entry sized ordinally from a warning-grade gated price row, no gap figure repeated",
        },
        evidenceRefs: [price.insight_type],
        knowledgeVersion: KNOWLEDGE_VERSION,
      })
    }
  }

  if (conversion && out.length < 2) {
    out.push({
      title: "Let guests book you as easily as they book the rival",
      rationale: `Grounded in ${conversion.title}. The same searchers find both of you; there, acting on the urge is one tap, and here it is a phone call that may go unanswered. Close the gap in margin order: reservations and catering requests first, because those carry the biggest bookings and the repeat business, then online ordering with the commission math in front of you. Each one is a button on your site and profile, not a project, and each should only go live if your team can actually answer what comes through it.`,
      skillId: "positioning",
      ownerRole: "owner" as const,
      kind: "positioning" as const,
      stance: "fix" as const, // a warning-grade feature gap is bookings bleeding next door
      recipe: [
        {
          channel: "your website + Google Business profile",
          platforms: [],
          audience: "ready-to-book guests who search, compare, and act within the hour",
          window: { note: "set up this week; live before the weekend" },
          dependencies: [
            "the features the signal names, taken in margin order",
            "whoever edits your site, for about an hour",
          ],
        },
      ],
      confidence: "medium" as const,
      leverage: {
        label: "medium" as const,
        basisInternal:
          "fallback play; conversion parity sized ordinally from a warning-grade multi-feature gap, no figures asserted",
      },
      evidenceRefs: [conversion.insight_type],
      knowledgeVersion: KNOWLEDGE_VERSION,
    })
  }

  return out.slice(0, 2)
}

export const positioningSkill: ProducerSkill = {
  id: "positioning",
  displayName: "Positioning & Pricing expert",
  ownerRole: "owner",
  kind: "positioning",
  category: "positioning",
  tier: "reasoning",
  // effort left at the default (medium): the menu reads are DISTILLED (v1 passed whole
  // MenuSnapshot objects — the real token hazard) and every signal family is capped, so
  // the prompt stays well under the ~40k-char size that forced guerrilla to "low".
  // WATCH ITEM: if p95 nears the 120s abort on menu-heavy orgs, flip to `effort: "low"`
  // (the proven lever) rather than letting the skill silently degrade to the fallback.
  //
  // temperature stays at v1's 0.4 ON PURPOSE (operations' precision setting, not
  // marketing's 0.6): this domain moves real prices on real menus, where drift is
  // costly; boldness comes from the playbook, not heat.
  temperature: 0.4,
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: POSITIONING_KNOWLEDGE,
  selectInput,
  selectStableInput,
  buildPrompt: (d, k) => buildSkillPrompt(positioningSkill, d, selectInput(d), k),
  parse,
  fallback,
  // P14 learning hook (new in v2, mirrors the exemplars): click feedback becomes
  // learnable per-archetype via POSITIONING_ARCHETYPES keys; external trend/editorial
  // snippets (e.g. fee-law changes, delivery-platform policy shifts, menu-pricing
  // research) may inform the prompt but never add citable refs.
  learning: {
    streams: ["external", "click", "ask"],
    playTypeLeadDomain: "positioning",
    acceptedLearningKinds: ["external_trend", "editorial"],
  },
}
