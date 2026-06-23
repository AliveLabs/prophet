"use client"

// P8 — per-operator category rerank controls. The operator boosts or de-emphasizes the
// DOMAINS they care about for THIS location; we layer that over the global priors and rank
// the next brief with it. Like Brief Tuning, changes apply to the NEXT brief (never silently
// rewrite today's). A modest reweight (0.5–1.5×), never a hard filter — a strong play in a
// down-weighted category can still lead.

import { useMemo, useState, useTransition } from "react"
import {
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  DEFAULT_CATEGORY_PRIORS,
  resolveCategoryPriors,
  PRIOR_MIN,
  PRIOR_MAX,
  type CategoryPriors,
} from "@/lib/skills/category-priors"
import type { Category } from "@/lib/skills/types"
import { setCategoryPriors } from "./actions"

function emphasisLabel(v: number): string {
  if (v >= 1.25) return "Much more"
  if (v >= 1.05) return "More"
  if (v > 0.95) return "Default"
  if (v > 0.7) return "Less"
  return "Much less"
}

export default function CategoryPriorsControls({
  initial,
  locationId,
}: {
  initial: CategoryPriors | null
  locationId?: string
}) {
  const start = useMemo(() => resolveCategoryPriors(initial), [initial])
  const [values, setValues] = useState<Record<Category, number>>(start)
  const [applied, setApplied] = useState<Record<Category, number>>(start)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const dirty = CATEGORY_ORDER.some((c) => values[c] !== applied[c])
  const customized = CATEGORY_ORDER.some((c) => values[c] !== DEFAULT_CATEGORY_PRIORS[c])

  function setOne(cat: Category, v: number) {
    setValues((prev) => ({ ...prev, [cat]: v }))
  }

  function reset() {
    setValues({ ...DEFAULT_CATEGORY_PRIORS })
  }

  function apply() {
    setSaveError(null)
    if (locationId) {
      startSaving(async () => {
        const res = await setCategoryPriors(locationId, values)
        if (!res.ok) {
          setSaveError(res.error ?? "Could not save — try again.")
          return
        }
        setApplied(values)
      })
    } else {
      setApplied(values)
    }
  }

  return (
    <div className="cp">
      {CATEGORY_ORDER.map((cat) => {
        const v = values[cat]
        const isDefault = v === DEFAULT_CATEGORY_PRIORS[cat]
        return (
          <div className="cp__row" key={cat}>
            <div className="cp__head">
              <span className="cp__label">{CATEGORY_LABELS[cat]}</span>
              <span className="cp__emph">{emphasisLabel(v)}</span>
            </div>
            <input
              className="pv-range"
              type="range"
              min={PRIOR_MIN}
              max={PRIOR_MAX}
              step={0.05}
              value={v}
              aria-label={`${CATEGORY_LABELS[cat]} emphasis`}
              onChange={(e) => setOne(cat, Number(e.target.value))}
            />
            <div className="cp__ends">
              <span>Less</span>
              <span className="cp__mult">{v.toFixed(2)}×{isDefault ? " (default)" : ""}</span>
              <span>More</span>
            </div>
          </div>
        )
      })}

      <div className="cp__foot">
        <button type="button" className="cp__apply" disabled={!dirty || saving} onClick={apply}>
          {saving ? "Saving…" : "Update my recommendations"}
        </button>
        <button
          type="button"
          className="cp__reset"
          disabled={!customized || saving}
          onClick={reset}
        >
          Reset to defaults
        </button>
        <span className="cp__hint">
          {saveError ?? (dirty ? "Applies to your next brief — today's stays as it is." : "Up to date.")}
        </span>
      </div>
    </div>
  )
}
