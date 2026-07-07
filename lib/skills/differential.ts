// ---------------------------------------------------------------------------
// Differential builds (Phase 1) — decide, per skill, whether yesterday's real output can be reused.
//
// A skill is REUSABLE today iff, in the previous brief: it ran for real (status ok, NOT a fallback),
// recorded an inputHash, and persisted its raw plays (Brief.skillOutputs) — and the previous brief is
// recent (≤ MAX_REUSE_AGE_DAYS; the Sunday full build re-anchors everything weekly regardless).
// The actual hash comparison happens in runProducerSkill against the FRESH hash.
//
// Kill switches (checked by the CALLERS, which simply don't pass `previous`):
//   env DIFFERENTIAL_BUILDS=0 · ?fullBuild=1 · Sunday-local full-build day · first build ever.
// ---------------------------------------------------------------------------

import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"

/** Never reuse output older than this many days — the weekly Sunday full build normally re-anchors
 *  sooner; this is the hard bound if a location misses its Sunday (downtime, onboarding mid-week). */
export const MAX_REUSE_AGE_DAYS = 6

export type PreviousBuild = {
  /** Last REAL run's input hash per skill (fallback-served runs are excluded — never reuse a floor). */
  hashes: Record<string, string>
  /** The raw grounded plays that hash produced. */
  outputs: Record<string, EnrichedRecommendation[]>
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
    if (h.status !== "ok" || h.usedFallback || !h.inputHash) continue
    const plays = brief.skillOutputs[h.skillId]
    if (!Array.isArray(plays)) continue // a real run with 0 grounded plays IS reusable (honest quiet)
    hashes[h.skillId] = h.inputHash
    outputs[h.skillId] = plays
  }
  return Object.keys(hashes).length > 0 ? { hashes, outputs } : undefined
}
