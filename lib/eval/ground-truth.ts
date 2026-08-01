// ---------------------------------------------------------------------------
// Judge ground truth, captured at build time (ALT-543 step 5).
//
// The nightly judge scores REAL SERVED BRIEFS. To score one it needs the facts the brief was built
// from, and the dossier is not persisted anywhere. Rebuilding it later is not an option: buildDossier
// calls fetchForecast / fetchBusyTimes / fetchPlaceDetails, so a nightly rebuild would multiply the
// most expensive part of the system — the opposite of the point of the cost programme. (A frozen
// golden-set rig that DOES rebuild is ticketed separately, scoped to sweep windows.)
//
// So the compact summary is captured here, once, while the dossier is still in memory, and rides
// along in the brief's existing jsonb.
// ---------------------------------------------------------------------------

import { dossierSummary } from "@/lib/eval/gate"
import type { Dossier } from "@/lib/insights/dossier/types"

/** Size cap for the persisted summary. Generous enough that a normal dossier fits whole, bounded so
 *  a pathological one cannot bloat every row of `daily_briefs`. */
export const MAX_GROUND_TRUTH_CHARS = 48_000

export type BriefGroundTruth = { summary: string; truncated: boolean }

/**
 * Compact ground truth for one dossier, or `undefined` if it could not be produced.
 *
 * TRUNCATION IS LOAD-BEARING, not cosmetic: the judge penalises any claim it cannot find in the
 * ground truth, so scoring against a truncated summary would mark real, properly-grounded claims as
 * fabricated and record a falsely low score. The flag exists so the nightly judge can SKIP those
 * briefs rather than poison the trend with them.
 */
export function briefGroundTruth(dossier: Dossier): BriefGroundTruth | undefined {
  try {
    const full = dossierSummary(dossier)
    if (full.length <= MAX_GROUND_TRUTH_CHARS) return { summary: full, truncated: false }
    return { summary: full.slice(0, MAX_GROUND_TRUTH_CHARS), truncated: true }
  } catch (err) {
    // Never break a build to capture telemetry.
    console.warn(`[ground-truth] capture failed for ${dossier.locationId} (brief unaffected):`, err)
    return undefined
  }
}
