// Shared categorical busy levels — the ONE user-facing encoding of a relative busy score:
// plain words, never a raw percentage. Same thresholds on every surface so "Busy" means the
// same thing on Competitors (ALT-262/265) and Traffic (ALT-286). Operator research showed bare
// popular-times percentages read as occupancy ("percent of what?"); Google itself only shows
// categorical labels. Percentages, when shown at all, stay as supporting tooltip detail.

export const BUSY_LEVEL_LABEL = ["Quiet", "Steady", "Busy", "Their peak"] as const

export type BusyLevel = -1 | 0 | 1 | 2 | 3

// -1 = closed / no data; 0..3 index BUSY_LEVEL_LABEL. Thresholds tuned so "Their peak" only
// claims the top of a spot's own curve.
export function busyLevel(score: number): BusyLevel {
  if (score <= 0) return -1
  if (score < 40) return 0
  if (score < 70) return 1
  if (score < 90) return 2
  return 3
}

// Representative score per level (0..3) for a discrete swatch/cell color off the same gold ramp.
export const BUSY_LEVEL_REP = [28, 58, 82, 100] as const
