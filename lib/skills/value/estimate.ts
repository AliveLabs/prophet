// ---------------------------------------------------------------------------
// Value / ROI — qualitative only (Bryan's call: no dollar figures to customers).
// Each play already carries a `leverage` label set by its skill. This aggregates
// leverage for the brief surface and provides an ordinal rank weight the engine can
// use. Dollar sizing, if ever computed, stays internal in leverage.basisInternal.
// ---------------------------------------------------------------------------

import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"

const RANK: Record<"high" | "medium" | "low", number> = { high: 3, medium: 2, low: 1 }

/** Ordinal leverage weight for ranking (0 if unset). */
export function leverageWeight(p: EnrichedRecommendation): number {
  return p.leverage ? RANK[p.leverage.label] : 0
}

export type LeverageSummary = { high: number; medium: number; low: number; headline: string }

/** A short, qualitative leverage summary for the brief (no dollars). */
export function briefLeverageSummary(brief: Brief): LeverageSummary {
  const counts = { high: 0, medium: 0, low: 0 }
  for (const p of brief.plays) {
    if (p.leverage) counts[p.leverage.label]++
  }
  const parts: string[] = []
  if (counts.high) parts.push(`${counts.high} high-leverage`)
  if (counts.medium) parts.push(`${counts.medium} medium`)
  if (counts.low) parts.push(`${counts.low} low`)
  return { ...counts, headline: parts.length ? `This week: ${parts.join(", ")}.` : "" }
}
