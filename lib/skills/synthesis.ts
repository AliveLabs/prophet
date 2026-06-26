// ---------------------------------------------------------------------------
// Chief-of-Staff synthesis (Phase 1/3) — selects, ranks, and wraps the brief.
//
// Takes every producer skill's grounded plays and produces the day's Brief:
// a 3-8 word headline, a short deck, and the 1-3 plays that actually matter.
// Ruthlessly SUBTRACTIVE; forward demand outranks standing rivalry. It SELECTS and
// ORDERS plays but never edits their recipes (grounding is preserved). ONE diversity
// exception: a grassroots visibility floor (guarantee ≥1 grassroots play — see below).
// Deterministic fallback guarantees a brief even on model failure.
// ---------------------------------------------------------------------------

import { generateStructured, DEEP_MODEL, type Transport } from "@/lib/ai/provider"
import { buildRefIndex, type Dossier } from "@/lib/insights/dossier/types"
import type { SkillResult } from "@/lib/skills/skill-types"
import type { Brief, BriefCoverage, EnrichedRecommendation, RecKind, Category } from "@/lib/skills/types"
import { rankPlays, computeCombinedScore, calibrationOf, type ScoreInput } from "@/lib/skills/scoring-config"
import { resolveCategoryPriors } from "@/lib/skills/category-priors"
import { fuseNearDuplicates } from "@/lib/skills/fusion"
import { playKey, computePlayTypeKey } from "@/lib/skills/preferences"
import { NEUTRAL_LOOKUP, type PlayTypeMultiplierLookup } from "@/lib/skills/feedback-rollup"
import { observeShadow } from "@/lib/skills/shadow"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"

export type SynthOptions = {
  transport?: Transport
  maxPlays?: number
  /** P7a: playKeys in cross-day dismissal cooldown — filtered out of the pool before ranking so a
   *  dismissed play doesn't regenerate into the next brief until its cooldown expires. */
  suppressedKeys?: Set<string>
  /** P7b: persisted "saved" plays — resurfaced into the pool when their grounding signals re-fire
   *  today (and they're not already produced or in cooldown). Loaded by the build caller. */
  evergreen?: EnrichedRecommendation[]
  /** P15: the distilled click-feedback multiplier lookup (skill_feedback_rollup), loaded by the build
   *  caller for this location's scope. Applied as a THIRD clamped factor (0.7–1.3) ALONGSIDE the
   *  category prior. Absent → NEUTRAL_LOOKUP (every play × 1.0) ⇒ ranking byte-identical to today. */
  playTypeMultipliers?: PlayTypeMultiplierLookup
  /** P17a SHADOW MODE: a multiplier lookup built from SHADOW-status feedback_pattern rows. It NEVER
   *  affects the served brief — it is only overlaid on a SHADOW REPLAY of the ranking, and we LOG
   *  whether it would have reordered/changed selection (mirrors the priorFlipped log). Absent →
   *  NEUTRAL_LOOKUP + shadowSignalCount 0 ⇒ nothing computed, nothing logged (floor = today). */
  shadowMultipliers?: PlayTypeMultiplierLookup
  /** How many shadow multipliers were in play (0 → the shadow replay is skipped entirely). */
  shadowSignalCount?: number
}

/** P7b: cap on how many persisted plays may resurface into one brief (avoid flooding). */
const MAX_RESURFACED = 3

/** P7b: only STANDING-advice kinds may resurface. demand/marketing/menu/grassroots plays are
 *  prepare/capitalize — TIME-BOUND, with their dated specifics in the body (not the cited ref), so
 *  re-resolving the bare ref would resurface a stale date/number verbatim. positioning/reputation/ops
 *  are durable standing advice that's safe to bring back. (P7b review finding #1.) */
const RESURFACE_KINDS = new Set<RecKind>(["reputation", "positioning", "ops"])

// The weekly brief is the spine (deep), so it carries the strongest plays across the
// distinct kinds of opportunity. A daily glance can pass a smaller maxPlays.
const WEEKLY_MAX = 7

/** What the engine checked for this location — fired vs missing — for the "what we checked" view. */
function buildCoverage(d: Dossier): BriefCoverage[] {
  const events = d.demandCalendar.events ?? []
  const wx = d.demandCalendar.weather ?? []
  const comps = d.competitors ?? []
  const scraped = comps.filter((c) => c.listing || c.menu).length
  const reviewThemes = d.location.reviews?.themes?.length ?? 0
  const hasSocial = d.ruleOutputs.some((r) => r.insight_type.startsWith("social"))
  return [
    { label: "Events", present: events.length > 0, detail: events.length ? `${events.length} upcoming` : "none upcoming" },
    { label: "Weather", present: wx.length > 0, detail: wx.length ? `${wx.length}-day forecast` : "no forecast" },
    { label: "Reviews", present: reviewThemes > 0, detail: reviewThemes ? `${reviewThemes} themes` : "none" },
    { label: "Foot traffic", present: !!d.location.busyTimes, detail: d.location.busyTimes ? "your patterns" : "missing" },
    { label: "Your menu", present: !!d.location.menu, detail: d.location.menu ? "parsed" : "missing" },
    { label: "Competitors", present: comps.length > 0, detail: `${scraped} of ${comps.length} scraped` },
    { label: "Social", present: hasSocial, detail: hasSocial ? "tracked" : "not connected" },
  ]
}

// Each play's operator-facing domain is its producing skill's intrinsic category
// (no RecKind→Category translation layer — see types.ts Category). Built once from
// the registry; a play whose skill can't be resolved falls back to a neutral prior.
const CATEGORY_BY_SKILL: Record<string, Category> = Object.fromEntries(
  PRODUCER_SKILLS.map((s) => [s.id, s.category]),
)

// P15: each skill's declared lead-domain for the play_type_key (its learning hook). Preferred over
// deriving the domain from evidenceRefs because it's stable + intentional. Absent → derived per-play.
const LEAD_DOMAIN_BY_SKILL: Record<string, string> = Object.fromEntries(
  PRODUCER_SKILLS.filter((s) => s.learning?.playTypeLeadDomain).map((s) => [s.id, s.learning!.playTypeLeadDomain]),
)

/** Map a play to its scoring factors: confidence, impact (leverage.label), category, and (P15) the
 *  distilled click-feedback multiplier for its play_type_key (1.0 when no rollup applies). The
 *  multiplier lookup defaults to NEUTRAL_LOOKUP so callers that don't pass one (e.g. fusion's
 *  scoreOf) behave exactly as pre-P15. */
function toScoreInput(p: EnrichedRecommendation, multipliers: PlayTypeMultiplierLookup = NEUTRAL_LOOKUP): ScoreInput {
  const category = CATEGORY_BY_SKILL[p.skillId]
  if (!category) {
    // Defensive: a play from a skill not in the registry shouldn't happen — surface the
    // misconfig rather than silently scoring it at the neutral 1.0 prior.
    console.warn(`[synthesis] no category for skillId "${p.skillId}"; scoring at neutral prior`)
  }
  const playTypeKey = computePlayTypeKey(p, { leadDomainOverride: LEAD_DOMAIN_BY_SKILL[p.skillId] })
  return {
    confidence: p.confidence,
    impact: p.leverage?.label,
    category: category ?? "marketing", // marketing == the neutral 1.0 prior
    // P11: a maintain play with no failure signal is capped at low impact before scoring, so a
    // best-practice habit ("keep replying to reviews") can't outrank a real problem.
    ...calibrationOf(p),
    // P15: the click-feedback nudge for this play's TYPE (clamped 0.7–1.3; 1.0 when no rollup). It
    // rides ALONGSIDE the category prior in computeCombinedScore/rankPlays — never inverting rank.
    playTypeMultiplier: multipliers.multiplierFor(playTypeKey),
  }
}

// Human, grounded deck themes per kind — used when the model's framing is unavailable.
const KIND_DECK: Record<RecKind, string> = {
  prepare: "staffing and prep",
  capitalize: "demand to capture",
  reputation: "reputation",
  positioning: "positioning",
  ops: "operations",
}

/** A SPECIFIC deterministic deck (no fabricated numbers) for when the model deck is missing. */
function deterministicDeck(plays: EnrichedRecommendation[]): string {
  const themes = Array.from(new Set(plays.map((p) => KIND_DECK[p.kind]).filter(Boolean)))
  const n = plays.length
  if (themes.length === 0) return `Your ${n} priorities this week, ranked by impact.`
  const list = themes.length === 1 ? themes[0] : themes.slice(0, -1).join(", ") + " and " + themes[themes.length - 1]
  return `Your ${n} ${n === 1 ? "move" : "moves"} this week, across ${list}, ranked by impact.`
}

function quietBrief(d: Dossier): Brief {
  return {
    locationId: d.locationId,
    dateKey: d.dateKey,
    headline: "A quiet week. Hold your ground.",
    deck: "No urgent moves and nothing on the calendar or forecast worth flagging. We will surface the moment something moves.",
    plays: [],
    asOf: d.generatedAt,
    coverage: d.coverage ?? buildCoverage(d),
  }
}

export async function synthesize(d: Dossier, results: SkillResult[], opts: SynthOptions = {}): Promise<Brief> {
  const max = opts.maxPlays ?? WEEKLY_MAX
  // P8: effective category priors = the operator's per-location override (if any) layered
  // over the global priors. Used everywhere a play is scored/ranked below.
  const priors = resolveCategoryPriors(d.profile.categoryPriors)
  // P15: the distilled click-feedback multiplier lookup for this location (loaded by the build
  // caller). Defaults to NEUTRAL_LOOKUP (every play × 1.0) so synthesis is byte-identical to today
  // when no rollup is wired/present. Bound into the local scoring closure below.
  const multipliers = opts.playTypeMultipliers ?? NEUTRAL_LOOKUP
  const scoreInput = (p: EnrichedRecommendation): ScoreInput => toScoreInput(p, multipliers)
  // Prefer the rich per-signal coverage the dossier builder computes (with as-of/staleness);
  // fall back to a basic derivation for hand-built fixtures that omit it.
  const coverage = d.coverage ?? buildCoverage(d)
  // P7a: drop plays whose playKey is in cross-day dismissal cooldown (the user dismissed it recently),
  // so it doesn't regenerate into this brief. Applied before fusion + the empty check.
  const produced = results.flatMap((r) => r.plays)
  const candidates =
    opts.suppressedKeys && opts.suppressedKeys.size
      ? produced.filter((p) => !opts.suppressedKeys!.has(playKey(p)))
      : produced
  // No early return on empty candidates — a quiet day can still resurface a relevant saved play (P7b).

  // P6.5: fuse near-duplicate plays (two lenses on ONE signal) into a single richer play BEFORE
  // ranking, so the pool the model selects from has no split near-dups. One cheap reasoning call per
  // fusable cluster; deterministic keep-best fallback. Usually a no-op (no clusters → no LLM call).
  const fusedPool = await fuseNearDuplicates(candidates, d, {
    transport: opts.transport,
    scoreOf: (p) => computeCombinedScore(scoreInput(p), priors),
  })
  // P7a: suppress again AFTER fusion. The pre-fusion filter above catches dismissed PRODUCER plays
  // (and keeps them out of fusion); this catches a dismissed FUSED play, whose stableKey is stable
  // across re-fusion even though its model-written title is not. (playKey prefers stableKey.)
  let pool =
    opts.suppressedKeys && opts.suppressedKeys.size
      ? fusedPool.filter((p) => !opts.suppressedKeys!.has(playKey(p)))
      : fusedPool

  // P7b: resurface persisted "saved" plays whose grounding signals re-fire today (relevance match),
  // that aren't already produced or in cooldown. They then compete in ranking like any grounded play.
  if (opts.evergreen?.length) {
    const present = new Set(pool.map(playKey))
    const allowedRefs = buildRefIndex(d).allowedRefs
    const resurfaced = opts.evergreen
      .filter((p) => RESURFACE_KINDS.has(p.kind)) // standing advice only — never resurface dated plays verbatim (#1)
      .filter((p) => !present.has(playKey(p)))
      .filter((p) => !opts.suppressedKeys?.has(playKey(p)))
      .filter((p) => (p.evidenceRefs?.length ?? 0) > 0 && p.evidenceRefs.every((r) => allowedRefs.has(r)))
      // Strongest first so the cap keeps the best — don't rely on the DB load order (#3).
      .sort((a, b) => computeCombinedScore(scoreInput(b), priors) - computeCombinedScore(scoreInput(a), priors))
      .slice(0, MAX_RESURFACED)
      // Drop any persisted reach figure — it may no longer trace to a live signal (#4).
      .map((p) => (p.leverage?.reach ? { ...p, leverage: { ...p.leverage, reach: undefined } } : p))
    if (resurfaced.length) pool = [...pool, ...resurfaced]
  }

  if (pool.length === 0) return quietBrief(d)

  // Score and rank the whole pool ONCE on the continuous combined score (impact +
  // confidence + importance, × a modest category prior). This is the deterministic
  // spine the model may reorder on success, and the grounded fallback otherwise.
  // leverage (impact) now actually drives rank — the old KIND ladder ignored it.
  const { ranked, priorFlipped } = rankPlays(pool, scoreInput, priors)
  const rankedPlays = ranked.map((r) => r.item)
  const scoreByPlay = new Map(ranked.map((r) => [r.item, r.score]))
  if (priorFlipped) {
    // Instrument when the category priors changed the order vs the base alone, so the
    // SEED priors can be calibrated from evidence rather than asserted.
    console.log(
      `[synthesis] prior-flip: category priors reordered ${pool.length} plays (${d.locationId} ${d.dateKey})`,
    )
  }

  // P17a SHADOW MODE: replay the ranking with shadow-status multipliers overlaid and LOG whether they
  // WOULD reorder / change selection — WITHOUT touching `ranked`/`rankedPlays` above (the served pool
  // is already fixed). Pure compute + log; a no-op when shadowSignalCount is 0 (floor = today).
  if ((opts.shadowSignalCount ?? 0) > 0) {
    observeShadow({
      pool,
      baseScoreInput: scoreInput,
      servedMultipliers: multipliers,
      shadowMultipliers: opts.shadowMultipliers ?? NEUTRAL_LOOKUP,
      toScoreInputWith: (p, m) => toScoreInput(p, m),
      priors,
      maxPlays: max,
      shadowSignalCount: opts.shadowSignalCount ?? 0,
      keyOf: (p) => computePlayTypeKey(p, { leadDomainOverride: LEAD_DOMAIN_BY_SKILL[p.skillId] }),
      locationId: d.locationId,
      dateKey: d.dateKey,
    })
  }

  const system = [
    "You are the Chief of Staff assembling a restaurant's WEEKLY brief from candidate plays produced by expert skills.",
    `Select the strongest plays that genuinely matter this week, up to ${max}. This is the weekly deep brief, so cover the DISTINCT kinds of opportunity that are real for this place: forward demand (events/weather), reputation, positioning, marketing, and operations.`,
    "Quality bar stays high: drop weak, generic, or near-duplicate plays, and never pad to hit the number. A calm week may have few; a busy one more.",
    "Order them best-first. Forward demand (events/weather this week) leads; standing competitive and operational moves follow. Do NOT force variety, but do not collapse to a single play when several distinct, strong opportunities exist.",
    "Write a 3-8 word headline and a 140-250 character deck that frame the week as a whole. Plain language, no em dashes, no chef jargon.",
    "Do NOT edit the plays. Only select and order them, and state any number ONLY if it appears in the plays.",
    'Return JSON: { "headline": string, "deck": string, "order": number[] (indices into the candidates array, best first) }.',
  ].join("\n")

  const prompt = JSON.stringify(
    { dateKey: d.dateKey, profile: { name: d.profile.name, attributes: d.profile.attributes }, candidates: pool },
    null,
    2,
  )

  // P5: the Chief-of-Staff synthesis runs on the DEEP pass (Opus + adaptive thinking) — the
  // ranking/selection across the whole pool (now including convergence plays) is where depth pays.
  const selection = await generateStructured<{ headline: string; deck: string; order: number[] }>(
    { tier: "reasoning", system, prompt, model: DEEP_MODEL, thinking: true, effort: "high" },
    {
      transport: opts.transport,
      validate: (raw) => {
        // Salvage the model's framing even if `order` is malformed/empty — a tiny
        // ordering glitch must NOT throw away a good headline + deck. Deterministic
        // ranking fills in below when the order is unusable.
        const r = raw as { headline?: unknown; deck?: unknown; order?: unknown }
        if (typeof r?.headline !== "string" || typeof r?.deck !== "string") return null
        if (!r.headline.trim() || !r.deck.trim()) return null
        const order = Array.isArray(r?.order)
          ? (r.order as unknown[]).filter((n): n is number => typeof n === "number" && n >= 0 && n < pool.length)
          : []
        return { headline: r.headline, deck: r.deck, order }
      },
      fallback: () => {
        const top = rankedPlays.slice(0, max)
        return {
          headline: top[0]?.title ?? "Your brief",
          deck: deterministicDeck(top),
          order: top.map((p) => pool.indexOf(p)),
        }
      },
    },
  )

  // Dedupe the model's order so a repeated index can't ship the same play twice.
  const ordered = [...new Set(selection.order)].map((i) => pool[i]).filter(Boolean).slice(0, max)
  const chosen = ordered.length ? ordered : rankedPlays.slice(0, max)

  // GRASSROOTS VISIBILITY FLOOR (Bryan 2026-06-25): grassroots (zero-budget hyper-local growth) is a top
  // strategic need for our target operators — and something even chains worry about — but it scores
  // mid-pack: its IMPACT is fine (~medium) while its CONFIDENCE lands medium/directional, so against the
  // high-confidence convergence/menu/social plays the Opus selector ("do NOT force variety") often drops
  // it (observed natural rank: 3rd-6th, and sometimes off the brief entirely). GUARANTEE the single BEST
  // grassroots play a slot, WITHOUT thumbing the merit ranking of everything else (the category priors
  // stay neutral / "earn the bias from evidence"). If the pool has no grassroots play (no partners / none
  // generated), there is nothing to surface — correct. The play is appended (lowest position): a floor,
  // not a promotion. Tunable: drop this block to go flat, or add a min-quality gate if it ever surfaces
  // a weak one. (Every pooled play is already grounded — named anchor + real signal + not generic.)
  const isGrassrootsPlay = (p: EnrichedRecommendation) => CATEGORY_BY_SKILL[p.skillId] === "grassroots"
  let chosenFinal = chosen
  if (!chosenFinal.some(isGrassrootsPlay)) {
    const bestGrass = rankedPlays.find(isGrassrootsPlay) // rankedPlays is score-desc → first match = best
    if (bestGrass) {
      if (chosenFinal.length < max) {
        chosenFinal = [...chosenFinal, bestGrass]
      } else {
        // At the cap: drop the lowest-scored NON-grassroots play to make room (keep the selector's order).
        const weakest = chosenFinal
          .filter((p) => !isGrassrootsPlay(p))
          .reduce<EnrichedRecommendation | null>((lo, p) => (lo == null || (scoreByPlay.get(p) ?? 0) < (scoreByPlay.get(lo) ?? 0) ? p : lo), null)
        chosenFinal = [...chosenFinal.filter((p) => p !== weakest), bestGrass]
      }
      console.log(`[synthesis] grassroots floor: surfaced "${bestGrass.title}" (${d.locationId} ${d.dateKey})`)
    }
  }

  // P3: stamp each chosen play with its combined score + operator-facing category, for the
  // ranked display + category drill-down. Optional fields — old persisted briefs simply lack them.
  const plays = chosenFinal.map((p) => ({ ...p, combinedScore: scoreByPlay.get(p), category: CATEGORY_BY_SKILL[p.skillId] }))

  return {
    locationId: d.locationId,
    dateKey: d.dateKey,
    headline: selection.headline,
    deck: selection.deck,
    plays,
    asOf: d.generatedAt,
    coverage,
  }
}
