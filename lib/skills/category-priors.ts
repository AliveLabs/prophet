// ---------------------------------------------------------------------------
// Per-operator category priors (engine P8) — the "most customizable" lever.
//
// The global CATEGORY_PRIORS (scoring-config.ts) are a modest, evidence-tuned
// domain bias applied to every play's base score. P8 lets an OPERATOR override
// those priors per-location — "I care more about marketing than ops here" — by
// storing a partial map in locations.settings.categoryPriors. build.ts loads it
// onto the profile; synthesis resolves it over the global priors and ranks with
// the effective values. No migration (rides the existing settings JSONB).
//
// Constraints: a prior is clamped to [0.5, 1.5] — a MODEST reweight, never a gate
// (a strong play in a down-weighted category can still win). An operator override
// is stored ONLY for categories moved off their global default, so future global
// re-tuning still flows through for untouched categories.
// ---------------------------------------------------------------------------

import type { Category } from "@/lib/skills/types"
import { CATEGORY_PRIORS, NEUTRAL_PRIOR } from "@/lib/skills/scoring-config"

export const PRIOR_MIN = 0.5
export const PRIOR_MAX = 1.5

/** The global defaults a per-location override layers on top of. */
export const DEFAULT_CATEGORY_PRIORS: Record<Category, number> = CATEGORY_PRIORS

/** A per-location override — partial: only the categories the operator changed. */
export type CategoryPriors = Partial<Record<Category, number>>

/** Operator-facing ordering + labels for the controls UI. */
export const CATEGORY_ORDER: Category[] = [
  "demand",
  "marketing",
  "social",
  "grassroots",
  "menu",
  "positioning",
  "reputation",
  "operations",
  "convergence",
]

export const CATEGORY_LABELS: Record<Category, string> = {
  demand: "Demand (events & weather)",
  marketing: "Marketing (your own content)",
  social: "Social counter-strategy (vs rivals)",
  grassroots: "Grassroots (hyper-local hustle)",
  menu: "Menu & food",
  positioning: "Positioning",
  reputation: "Reputation",
  operations: "Operations",
  convergence: "Cross-signal convergence",
}

const KNOWN_CATEGORIES = new Set<string>(CATEGORY_ORDER)
const EPSILON = 0.001

export function clampPrior(v: number): number {
  return Math.min(PRIOR_MAX, Math.max(PRIOR_MIN, v))
}

/** Validate + sanitize an arbitrary (stored or submitted) value into a clean override:
 *  drop unknown keys + non-finite numbers, clamp the rest to [0.5, 1.5]. */
export function sanitizeCategoryPriors(input: unknown): CategoryPriors {
  if (!input || typeof input !== "object") return {}
  const out: CategoryPriors = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!KNOWN_CATEGORIES.has(k)) continue
    if (typeof v !== "number" || !Number.isFinite(v)) continue
    out[k as Category] = clampPrior(v)
  }
  return out
}

/** Minimize an override for storage: keep ONLY categories that differ from the global
 *  default, so untouched categories keep following future global re-tuning. */
export function diffFromDefaults(priors: CategoryPriors): CategoryPriors {
  const out: CategoryPriors = {}
  for (const cat of CATEGORY_ORDER) {
    const v = priors[cat]
    if (typeof v === "number" && Math.abs(v - DEFAULT_CATEGORY_PRIORS[cat]) > EPSILON) {
      out[cat] = v
    }
  }
  return out
}

/** Merge an operator override over the global defaults → the effective priors the
 *  ranker uses for this location. Always returns a complete, clamped map. */
export function resolveCategoryPriors(override: CategoryPriors | null | undefined): Record<Category, number> {
  const out: Record<Category, number> = { ...DEFAULT_CATEGORY_PRIORS }
  if (override) {
    for (const cat of CATEGORY_ORDER) {
      const v = override[cat]
      if (typeof v === "number" && Number.isFinite(v)) out[cat] = clampPrior(v)
    }
  }
  return out
}

/** The slider start positions for the UI: the operator's override where set, else the
 *  global default (so every slider shows where the category currently sits). */
export function effectiveSliderValues(override: CategoryPriors | null | undefined): Record<Category, number> {
  return resolveCategoryPriors(override)
}

/** An empty override — used by "reset to defaults". */
export function resetCategoryPriors(): CategoryPriors {
  return {}
}

export { NEUTRAL_PRIOR }
