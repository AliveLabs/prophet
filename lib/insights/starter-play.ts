// ---------------------------------------------------------------------------
// The STARTER INSIGHT (beta rescue Phase 3.1).
//
// A brand-new location's first session used to show nothing but pipeline row labels until a
// full brief finished. This runs ONE producer over the PARTIAL dossier as soon as the dossier
// carries a citable signal, so the operator holds a real, grounded insight in minutes instead
// of an hour. The full brief follows on its normal path and is never replaced by this.
//
// WHY reputation IS THE STARTER SKILL (the shallowest dossier requirement of the eight):
//   buildDossier pushes `review.theme` rule outputs itself, from the OWN Places details call it
//   already makes (fetchPlaceDetails -> analyzeReviews -> reviewInsightsFromSentiment). They are
//   therefore available on the FIRST dossier build, before the content / visibility / events /
//   social pipelines have written a single snapshot. Every other producer needs stored pipeline
//   output first:
//     positioning / marketing / social-counter  need competitor listings, menus or social rows
//     local-demand                              needs the events snapshot
//     guerrilla-marketing                       needs the partner catalog (events pipeline writes it)
//     convergence                               is the deep cross-domain pass, needs the whole dossier
//   `operations` is the one near-miss: buildDossier also pushes `hours.own_*` from the live
//   own-location busy-times pull, so it too can ground on a first dossier. reputation wins on
//   substance for a FIRST read: its refs carry verbatim guest quotes, which the unified card
//   renders as real cited artifacts, and its entity attribution is unambiguous (review.theme is
//   always the operator's own).
//
// EVERY ENGINE INVARIANT STILL HOLDS. This is a normal `runProducerSkill` call: same provider,
// same 32k output ceiling, same deterministic fallback, same `usedFallback` / FallbackReason
// recording, and the same ground filter (a play whose evidenceRefs do not resolve to the
// dossier's rule outputs is DROPPED). A partial dossier therefore cannot produce a claim the
// data does not support: fewer rule outputs means a smaller allowed-ref set, which means the
// filter is STRICTER here than on a full brief, not looser.
//
// The one deliberate difference is `effort: "low"`, and it is a LATENCY constraint, not a cost
// preference — exactly the case ProducerSkill.effort documents (guerrilla/marketing pin it for
// the same reason). The starter has a 2-3 minute budget to be worth anything, and a partial
// dossier makes reputation's prompt small, so low effort is the right point on the curve. The
// nightly reputation run is untouched and still takes the fleet dial.
//
// PROMPT CACHE: `systemCached` comes from the unmodified skill, so the starter call shares the
// byte-identical cached prefix with the nightly reputation call (reads at 0.1x).
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import { reputationSkill } from "@/lib/skills/reputation/skill"

/** The snapshot provider key the starter insight is stored under. Free-text column, no migration
 *  (same convention as `review_sentiment` / `google_places_profile` / `google_hours`). */
export const STARTER_SNAPSHOT_PROVIDER = "first_run_starter"

/** reputation, with effort pinned LOW for latency. Nothing else differs — same id, same
 *  knowledge version, same prompt, same parse, same fallback, so skillHealth and spend
 *  telemetry attribute this to `reputation` exactly as the nightly run does. */
export const starterSkill: ProducerSkill = { ...reputationSkill, effort: "low" }

// ── Readiness (pure) ───────────────────────────────────────────────────────────────────
// A READINESS CONDITION, NOT A TIMER. The starter runs when the dossier carries the citable
// family the starter skill grounds on, and is skipped (no model call, no spend) when it does
// not. Skipping is the honest outcome: reputation's own parse gate would drop every play that
// cannot cite a reputation ref anyway, so paying for the call would buy nothing.

export type StarterNotReadyReason =
  /** The dossier carries no rule outputs at all — nothing is citable yet. */
  | "no_signal_yet"
  /** Rule outputs exist, but none from the review family the starter skill grounds on. */
  | "no_review_signal"

/** The narrow read of a dossier that readiness depends on. Kept structural (not `Dossier`) so
 *  the decision is unit-testable without building a fixture dossier. */
export type StarterSignalRead = {
  /** insight_type of every rule output on the partial dossier. */
  ruleOutputTypes: readonly string[]
  /** Own review themes the sentiment pass produced (reasoning context, not refs). */
  ownReviewThemeCount: number
  /** Whether the own Places listing landed (rating + review count). */
  hasOwnListing: boolean
}

export type StarterReadiness = {
  ready: boolean
  reason: StarterNotReadyReason | null
  /** The citable refs the starter skill can actually ground on. */
  citableRefs: string[]
}

/** True for the own-review-theme family (mirrors reputation's `isOwnThemeSignal`). */
function isStarterGroundingRef(insightType: string): boolean {
  return insightType.startsWith("review.theme")
}

/** Narrow a dossier down to the readiness read. */
export function readStarterSignals(dossier: Dossier): StarterSignalRead {
  return {
    ruleOutputTypes: dossier.ruleOutputs.map((r) => r.insight_type),
    ownReviewThemeCount: dossier.location.reviews?.themes?.length ?? 0,
    hasOwnListing: !!dossier.location.listing?.profile,
  }
}

/** Should the starter producer run over this partial dossier? Pure. */
export function starterReadiness(read: StarterSignalRead): StarterReadiness {
  const citableRefs = read.ruleOutputTypes.filter(isStarterGroundingRef)
  if (citableRefs.length > 0) return { ready: true, reason: null, citableRefs }
  if (read.ruleOutputTypes.length === 0) {
    return { ready: false, reason: "no_signal_yet", citableRefs: [] }
  }
  return { ready: false, reason: "no_review_signal", citableRefs: [] }
}

/** Plain operator-facing line for a not-ready outcome. No filler, no promise about when. */
export function starterNotReadyMessage(reason: StarterNotReadyReason): string {
  switch (reason) {
    case "no_signal_yet":
      return "We have not read enough of your data to write an insight yet."
    case "no_review_signal":
      return "Your public reviews did not give us enough to write an insight from."
  }
}

// ── Pick (pure) ────────────────────────────────────────────────────────────────────────
// The starter shows ONE insight. Ranking is deterministic so the same producer output always
// yields the same starter, and so a rerun cannot shuffle what the operator already read.

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, directional: 1, low: 1 }

/**
 * The best starter from a producer's plays, or null when it produced none.
 * Order: a play with real steps beats an observation (the target is a USABLE insight), then
 * higher confidence, then more grounded refs, then original order (stable).
 */
export function pickStarterPlay(plays: readonly EnrichedRecommendation[]): EnrichedRecommendation | null {
  if (plays.length === 0) return null
  const ranked = plays
    .map((play, index) => ({ play, index }))
    .sort((a, b) => {
      const stepsA = (a.play.recipe ?? []).length > 0 ? 1 : 0
      const stepsB = (b.play.recipe ?? []).length > 0 ? 1 : 0
      if (stepsA !== stepsB) return stepsB - stepsA
      const confA = CONFIDENCE_RANK[a.play.confidence] ?? 0
      const confB = CONFIDENCE_RANK[b.play.confidence] ?? 0
      if (confA !== confB) return confB - confA
      const refsA = a.play.evidenceRefs?.length ?? 0
      const refsB = b.play.evidenceRefs?.length ?? 0
      if (refsA !== refsB) return refsB - refsA
      return a.index - b.index
    })
  return ranked[0]?.play ?? null
}

// ── Stored shape ───────────────────────────────────────────────────────────────────────

/** What lands in `location_snapshots.raw_data` under STARTER_SNAPSHOT_PROVIDER. */
export type StoredStarterInsight = {
  version: "1.0"
  generatedAt: string
  skillId: string
  knowledgeVersion: string
  /** true when the producer served its DETERMINISTIC fallback. Stored so the surface can stay
   *  honest and so a fleet-wide starter degradation is readable from the row, not just logs. */
  usedFallback: boolean
  fallbackReason?: string
  play: EnrichedRecommendation
}

/** Read a stored starter row's raw_data back, or null when it is not a starter payload. */
export function parseStoredStarter(raw: unknown): StoredStarterInsight | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Partial<StoredStarterInsight>
  const play = row.play as EnrichedRecommendation | undefined
  if (!play || typeof play.title !== "string" || typeof play.rationale !== "string") return null
  if (!Array.isArray(play.evidenceRefs) || play.evidenceRefs.length === 0) return null
  return {
    version: "1.0",
    generatedAt: typeof row.generatedAt === "string" ? row.generatedAt : "",
    skillId: typeof row.skillId === "string" ? row.skillId : play.skillId,
    knowledgeVersion: typeof row.knowledgeVersion === "string" ? row.knowledgeVersion : play.knowledgeVersion,
    usedFallback: row.usedFallback === true,
    ...(typeof row.fallbackReason === "string" ? { fallbackReason: row.fallbackReason } : {}),
    play,
  }
}
