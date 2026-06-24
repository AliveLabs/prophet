// ---------------------------------------------------------------------------
// Learning Spine L3 (P17a) — SHADOW MODE (§2.3.3, the key safety net).
//
// A `shadow`-status learning is COMPUTED + LOGGED but NEVER affects the served brief. This is how a
// learning earns trust before it can serve: we replay the EXACT ranking the served brief used, then
// replay it again with the shadow signal overlaid, and LOG whether the shadow signal WOULD have
// reordered the pool / changed which plays make the cut. Mirrors synthesis.ts's existing `priorFlipped`
// instrumentation pattern — same shape, same "log, don't change" discipline.
//
// SCORING shadow (the deterministic, testable one): a shadow feedback_pattern carries a play_type
// multiplier. We compute the served ranking (active multipliers only) vs the shadow ranking (active +
// shadow overlaid) and report the diff. The served ranking is computed by the caller WITHOUT shadow;
// this module never returns a reordered served pool — only the OBSERVATION.
//
// KNOWLEDGE/PROMPT shadow (external_trend / editorial) changes what the MODEL writes, not the
// deterministic rank — so for those we log PRESENCE (a shadow snippet was eligible for this build) for
// the admin queue; the before/after wording diff isn't deterministic and isn't asserted here.
//
// PURE + deterministic → unit-tests without a DB/LLM. The synthesis hook (observeShadow) wires the
// served pool + the shadow multiplier overlay and emits the log; it returns void and is side-effect
// only (logging) — it can NEVER mutate the served brief.
// ---------------------------------------------------------------------------

import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { ScoreInput } from "@/lib/skills/scoring-config"
import { rankPlays } from "@/lib/skills/scoring-config"
import type { Category } from "@/lib/skills/types"
import { NEUTRAL_LOOKUP, type PlayTypeMultiplierLookup } from "@/lib/skills/feedback-rollup"

/** What a shadow replay observed — logged, never served. */
export type ShadowObservation = {
  /** would the shadow signal have reordered the top-N pool vs the served ranking? */
  wouldReorder: boolean
  /** would it have changed WHICH plays make the cut (the chosen set), not just their order? */
  wouldChangeSelection: boolean
  /** play_type_keys whose served rank != shadow rank (for the log line). */
  movedKeys: string[]
  /** how many shadow multipliers were applied (0 → nothing to observe). */
  shadowSignalCount: number
}

const EMPTY_OBSERVATION: ShadowObservation = {
  wouldReorder: false,
  wouldChangeSelection: false,
  movedKeys: [],
  shadowSignalCount: 0,
}

/** Compose the served + shadow multiplier into ONE lookup: shadow nudges MULTIPLY onto the active
 *  nudge (so the shadow replay sees what serving BOTH would do). Returns a lookup; the SERVED lookup
 *  is never touched. */
export function overlayShadowMultipliers(
  served: PlayTypeMultiplierLookup,
  shadow: PlayTypeMultiplierLookup,
): PlayTypeMultiplierLookup {
  return {
    multiplierFor: (key: string) => served.multiplierFor(key) * shadow.multiplierFor(key),
  }
}

/**
 * Compute the shadow observation for a pool. PURE.
 *
 * @param pool             the EXACT play pool synthesis ranked (after fusion/suppression).
 * @param baseScoreInput   the served toScoreInput (uses the ACTIVE multiplier lookup) — the served ranking.
 * @param shadowScoreInput the same mapper but with shadow multipliers overlaid — the shadow ranking.
 * @param priors           the per-location category priors (passed straight through to rankPlays).
 * @param maxPlays         the served cut size (to detect a selection change, not just a reorder).
 * @param shadowSignalCount how many shadow multipliers were in play (0 → no-op observation).
 * @param keyOf            play → play_type_key (for the moved-keys log).
 *
 * Returns the diff between the served ranking and the shadow ranking. Empty/neutral when there are no
 * shadow signals (the floor — identical to today, nothing logged).
 */
export function computeShadowObservation(
  pool: EnrichedRecommendation[],
  baseScoreInput: (p: EnrichedRecommendation) => ScoreInput,
  shadowScoreInput: (p: EnrichedRecommendation) => ScoreInput,
  priors: Record<Category, number>,
  maxPlays: number,
  shadowSignalCount: number,
  keyOf: (p: EnrichedRecommendation) => string,
): ShadowObservation {
  if (shadowSignalCount === 0 || pool.length === 0) return EMPTY_OBSERVATION

  const served = rankPlays(pool, baseScoreInput, priors).ranked.map((r) => r.item)
  const shadow = rankPlays(pool, shadowScoreInput, priors).ranked.map((r) => r.item)

  // reorder: any position differs.
  const wouldReorder = served.some((p, i) => p !== shadow[i])

  // selection change: the chosen top-N set differs (a shadow nudge pushed a different play above the cut).
  const servedCut = new Set(served.slice(0, maxPlays))
  const shadowCut = shadow.slice(0, maxPlays)
  const wouldChangeSelection = shadowCut.some((p) => !servedCut.has(p))

  const movedKeys: string[] = []
  for (let i = 0; i < served.length; i++) {
    if (served[i] !== shadow[i]) {
      const k = keyOf(shadow[i])
      if (!movedKeys.includes(k)) movedKeys.push(k)
    }
  }

  return { wouldReorder, wouldChangeSelection, movedKeys, shadowSignalCount }
}

/**
 * Synthesis hook: COMPUTE the shadow observation for this build and LOG it (mirrors the priorFlipped
 * console.log). SIDE-EFFECT ONLY — returns void, never touches the served pool/brief. A no-op when
 * there are no shadow multipliers (shadowSignalCount 0) so an absent shadow table leaves the build
 * byte-identical to today (nothing computed, nothing logged).
 */
export function observeShadow(args: {
  pool: EnrichedRecommendation[]
  baseScoreInput: (p: EnrichedRecommendation) => ScoreInput
  shadowMultipliers: PlayTypeMultiplierLookup
  servedMultipliers: PlayTypeMultiplierLookup
  toScoreInputWith: (p: EnrichedRecommendation, m: PlayTypeMultiplierLookup) => ScoreInput
  priors: Record<Category, number>
  maxPlays: number
  shadowSignalCount: number
  keyOf: (p: EnrichedRecommendation) => string
  locationId: string
  dateKey: string
}): ShadowObservation {
  const obs = computeShadowObservation(
    args.pool,
    args.baseScoreInput,
    (p) => args.toScoreInputWith(p, overlayShadowMultipliers(args.servedMultipliers, args.shadowMultipliers)),
    args.priors,
    args.maxPlays,
    args.shadowSignalCount,
    args.keyOf,
  )
  if (obs.shadowSignalCount > 0 && (obs.wouldReorder || obs.wouldChangeSelection)) {
    console.log(
      `[synthesis] shadow-mode: ${obs.shadowSignalCount} shadow multiplier(s) WOULD ${obs.wouldChangeSelection ? "change selection" : "reorder"} ` +
        `(${obs.movedKeys.length} play-type(s): ${obs.movedKeys.slice(0, 5).join(", ")}) — NOT served (${args.locationId} ${args.dateKey})`,
    )
  }
  return obs
}
