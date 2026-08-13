// ---------------------------------------------------------------------------
// Differential builds (Phase 1) — decide, per skill, whether yesterday's real output can be reused.
//
// A skill is REUSABLE today iff, in the previous brief: it ran for real (status ok, NOT a fallback),
// recorded an inputHash, and persisted its raw plays (Brief.skillOutputs) — and the previous brief is
// recent (≤ MAX_REUSE_AGE_DAYS; the Sunday full build re-anchors everything weekly regardless).
// The actual hash comparison happens in runProducerSkill against the FRESH hash.
//
// Phase 2 (downstream reuse): when EVERY producer reused AND the downstream-input fingerprint
// matches the previous brief's, the downstream stage (safety review + synthesis + write) is also
// carried forward — see decideDownstreamReuse below and the reuse branch in lib/skills/pipeline.ts.
//
// Kill switches (checked by the CALLERS, which simply don't pass `previous`):
//   env DIFFERENTIAL_BUILDS=0 · ?fullBuild=1 · Sunday-local full-build day · first build ever.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto"
import { stableStringify } from "@/lib/skills/input-hash"
import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"

/** Never reuse output older than this many days — the weekly Sunday full build normally re-anchors
 *  sooner; this is the hard bound if a location misses its Sunday (downtime, onboarding mid-week). */
export const MAX_REUSE_AGE_DAYS = 6

/** Phase 2: the previous brief's reusable DOWNSTREAM state — the final served narrative + plays
 *  (post safety review, synthesis, write, presenter, voice) and the fingerprint of the downstream
 *  inputs that produced them. Only extracted from a non-fallback brief that actually carries all
 *  three, so "reuse" can never serve a hole. */
export type DownstreamState = {
  headline: string
  deck: string
  plays: EnrichedRecommendation[]
  fingerprint: string
}

export type PreviousBuild = {
  /** Last REAL run's input hash per skill (fallback-served runs are excluded — never reuse a floor). */
  hashes: Record<string, string>
  /** The raw grounded plays that hash produced. */
  outputs: Record<string, EnrichedRecommendation[]>
  /** Phase 2: the previous brief's downstream outputs, present only when that brief recorded a
   *  downstream fingerprint (post-Phase-2 builds) and was not itself a fallback brief. */
  downstream?: DownstreamState
}

/** Extract the reusable per-skill state from yesterday's brief. Returns undefined when nothing is
 *  reusable (no brief, no skillHealth/skillOutputs yet, or too old) — callers then run a full build. */
export function extractPreviousBuild(brief: Brief | null | undefined, todayKey: string): PreviousBuild | undefined {
  if (!brief?.skillHealth?.length || !brief.skillOutputs || !brief.dateKey) return undefined
  const ageDays = (Date.parse(todayKey) - Date.parse(brief.dateKey)) / 86_400_000
  if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > MAX_REUSE_AGE_DAYS) return undefined

  const hashes: Record<string, string> = {}
  const outputs: Record<string, EnrichedRecommendation[]> = {}
  for (const h of brief.skillHealth) {
    // A first-brief SKIP never ran, so there is nothing to carry forward. It already fails the
    // inputHash test below (a skipped slot records none), but state it explicitly: "we did not
    // call this expert" must never be readable as "this expert had nothing new to say".
    if (h.skipped) continue
    if (h.status !== "ok" || h.usedFallback || !h.inputHash) continue
    const plays = brief.skillOutputs[h.skillId]
    if (!Array.isArray(plays)) continue // a real run with 0 grounded plays IS reusable (honest quiet)
    hashes[h.skillId] = h.inputHash
    outputs[h.skillId] = plays
  }
  if (Object.keys(hashes).length === 0) return undefined

  // Phase 2: downstream state is reusable only when the brief carries the full served narrative AND
  // the fingerprint of the inputs that produced it, and the brief was not itself a failure fallback
  // (a brief served from yesterday's-good-brief fallback must never seed another day of reuse).
  // A pre-Phase-2 brief simply lacks the fingerprint → downstream stays undefined → full downstream.
  const downstream: DownstreamState | undefined =
    brief.fallback !== true &&
    typeof brief.downstreamFingerprint === "string" &&
    brief.downstreamFingerprint.length > 0 &&
    typeof brief.headline === "string" &&
    brief.headline.trim().length > 0 &&
    typeof brief.deck === "string" &&
    Array.isArray(brief.plays)
      ? { headline: brief.headline, deck: brief.deck, plays: brief.plays, fingerprint: brief.downstreamFingerprint }
      : undefined

  return { hashes, outputs, ...(downstream ? { downstream } : {}) }
}

// ---------------------------------------------------------------------------
// Phase 2 — downstream reuse (safety review + synthesis + write).
//
// The downstream stage is a function of MORE than the producer outputs: synthesis also reads the
// dismissal cooldown set (P7a), the evergreen resurfacing pool (P7b), the click-feedback play-type
// multipliers (P15), the operator's brand tolerance (harm-review drop line), the category priors
// (P8), maxPlays, and the profile framing embedded in the prompts. Producer input hashes cover NONE
// of those, so "all producers reused" alone is not enough — a play dismissed last night must not
// resurface just because the dossier didn't move. The fingerprint below captures every one of those
// inputs; equality across days means the downstream stage would see the same world, so yesterday's
// downstream OUTPUT (one valid answer to those inputs) is still valid and can carry forward.
//
// Assembly of the inputs from the live dossier/options lives in lib/skills/pipeline.ts
// (collectDownstreamInputs); this file keeps the pure, unit-testable core.
// ---------------------------------------------------------------------------

/** Everything the downstream stage depends on, normalized for hashing. Arrays must arrive in a
 *  deterministic order (stableStringify sorts object keys at every depth but preserves array order). */
export type DownstreamFingerprintInputs = {
  /** Per-skill input hash from THIS build (null when a skill recorded none — such a skill can never
   *  be reused, so downstream reuse is already impossible; the null still shapes the fingerprint). */
  skillHashes: Record<string, string | null>
  /** P7a dismissal-cooldown keys, sorted. */
  suppressedKeys: string[]
  /** P7b evergreen candidates, sorted by key: the full persisted play (content, not just identity)
   *  and whether its refs resolve against TODAY's dossier (the resurfacing gate). Their multiplier
   *  values land in playTypeMultipliers alongside the producer plays'. */
  evergreen: { key: string; play: EnrichedRecommendation; resolvable: boolean }[]
  /** P15 multiplier values probed over every candidate play's play_type_key (all severity bands, so
   *  a rollup change that only touches a bold/wild band still breaks the match). */
  playTypeMultipliers: Record<string, number>
  /** Harm-review drop line (defaulted the way applyHarmReview defaults it). */
  brandTolerance: number
  /** P8 per-location category-prior overrides (null when none). */
  categoryPriors: unknown
  maxPlays: number | null
  /** The profile framing the downstream prompts embed (synthesis + write + safety review). */
  profile: unknown
}

/** Deterministic sha256 over the downstream inputs. Version-prefixed: bumping `v` on any change to
 *  the payload SHAPE forces one full downstream build fleet-wide instead of a false match. */
export function downstreamFingerprint(inputs: DownstreamFingerprintInputs): string {
  return createHash("sha256").update(`downstream:v1 ${stableStringify(inputs)}`).digest("hex")
}

export type DownstreamReuseDecision = { reuse: true } | { reuse: false; reason: string }

/**
 * The Phase 2 skip decision. Reuse the previous brief's downstream outputs ONLY when:
 *   1. producers actually ran and EVERY one of them was reused (a single regeneration — or a skill
 *      that cannot hash, or a fallback — means the pool may differ → full downstream), AND
 *   2. the previous build carries reusable downstream state (post-Phase-2, non-fallback brief with
 *      headline/deck/plays + fingerprint — absence is not innocence), AND
 *   3. today's downstream-input fingerprint is computable and byte-equal to the previous one.
 * Any doubt (missing fingerprint, missing state, empty skill list) → build normally.
 */
export function decideDownstreamReuse(args: {
  skillResults: { skillId: string; reused?: boolean }[]
  previous: PreviousBuild | undefined
  todayFingerprint: string | undefined
}): DownstreamReuseDecision {
  const { skillResults, previous, todayFingerprint } = args
  if (!previous) return { reuse: false, reason: "no previous build (full-build day or no usable history)" }
  if (!previous.downstream) return { reuse: false, reason: "previous brief has no reusable downstream state" }
  if (skillResults.length === 0) return { reuse: false, reason: "no producers ran" }
  const regenerated = skillResults.filter((r) => !r.reused).map((r) => r.skillId)
  if (regenerated.length > 0) return { reuse: false, reason: `producers regenerated: ${regenerated.join(", ")}` }
  if (!todayFingerprint) return { reuse: false, reason: "downstream fingerprint unavailable for this build" }
  if (todayFingerprint !== previous.downstream.fingerprint) {
    return { reuse: false, reason: "downstream inputs changed (suppressions/evergreen/multipliers/tolerance/priors/profile)" }
  }
  return { reuse: true }
}
