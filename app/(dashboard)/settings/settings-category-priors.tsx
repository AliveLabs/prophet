"use client"

// Per-operator category rerank (P8), rebuilt to The Pass. Same wired behavior as
// category-priors-controls.tsx — it calls the SAME server action `setCategoryPriors`,
// the same resolve/default logic, and the same "applies to your NEXT brief, never a
// hard filter" contract. Only the presentation moves to the kit's tk-set-* controls.

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
import { TkButton, TkTooltip } from "@/components/ticket"

function emphasisLabel(v: number): string {
  if (v >= 1.25) return "Much more"
  if (v >= 1.05) return "More"
  if (v > 0.95) return "Default"
  if (v > 0.7) return "Less"
  return "Much less"
}

// What each category boosts, in plain operator language. Shown on hover/focus of
// the info trigger beside each control. ALT-222.
const CATEGORY_TIPS: Record<Category, string> = {
  demand:
    "Boosts moves tied to upcoming demand — local events, big games, holidays, and weather swings that change who walks in and when.",
  marketing:
    "Boosts ideas for your own posts, promos, and campaigns — the content and offers you put out to draw people in.",
  social:
    "Boosts plays that respond to what rival accounts are doing — where to counter, match, or pull ahead of nearby competitors.",
  grassroots:
    "Boosts hyper-local, low-cost hustle — neighborhood partnerships, on-the-ground outreach, and word-of-mouth tactics.",
  menu:
    "Boosts menu and food moves — items to feature, pricing tweaks, pairings, and seasonal additions.",
  positioning:
    "Boosts how you stand out — the angle, story, and reasons-to-choose that set you apart from the field.",
  reputation:
    "Boosts moves that shape what people say about you — reviews, ratings, and responding to feedback.",
  operations:
    "Boosts behind-the-counter moves — staffing, hours, throughput, and service changes that affect the guest experience.",
  convergence:
    "Boosts plays where several signals line up at once — the strongest opportunities backed by more than one source of evidence.",
}

export default function SettingsCategoryPriors({
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
        // A thrown action (proxy 403 while impersonating, deploy skew, network) must surface
        // exactly like a returned failure. Before this catch, a throw left the sliders showing
        // unsaved values with no error, which read as saved until the next full page load
        // (the "my sliders reset overnight" report, ALT-583).
        try {
          const res = await setCategoryPriors(locationId, values)
          if (!res.ok) {
            setSaveError(res.error ?? "Could not save. Try again.")
            return
          }
          setApplied(values)
        } catch {
          setSaveError("Could not save. Try again.")
        }
      })
    } else {
      setApplied(values)
    }
  }

  return (
    <div>
      <div className="tk-set-cp">
        {CATEGORY_ORDER.map((cat) => {
          const v = values[cat]
          const isDefault = v === DEFAULT_CATEGORY_PRIORS[cat]
          return (
            <div className="tk-set-cp-row" key={cat}>
              <div className="tk-set-cp-head">
                <span className="tk-set-cp-labelwrap">
                  <span className="tk-set-cp-label">{CATEGORY_LABELS[cat]}</span>
                  <TkTooltip tip={CATEGORY_TIPS[cat]} className="tk-set-info">
                    <span aria-hidden="true">i</span>
                    <span className="sr-only">{`What "${CATEGORY_LABELS[cat]}" boosts: ${CATEGORY_TIPS[cat]}`}</span>
                  </TkTooltip>
                </span>
                <span className="tk-set-cp-emph">{emphasisLabel(v)}</span>
              </div>
              <input
                className="tk-set-range"
                type="range"
                min={PRIOR_MIN}
                max={PRIOR_MAX}
                step={0.05}
                value={v}
                aria-label={`${CATEGORY_LABELS[cat]} emphasis`}
                onChange={(e) => setOne(cat, Number(e.target.value))}
              />
              <div className="tk-set-range-ends">
                <span>Less</span>
                <span className="tk-set-mid">{v.toFixed(2)}×{isDefault ? " (default)" : ""}</span>
                <span>More</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* ALT-583: the apply button used to be a quiet keep-variant that only APPEARED once a
          slider moved, left of the hint. Bryan overlooked it dozens of times, so the priors were
          never saved and every "overnight reset" traced back to this. It is now always present
          (disabled until dirty), primary, and rightmost; the hint anchors left (CSS). Keep it
          that way: a pop-in save button on a settings surface is invisible. */}
      <div className="tk-set-apply-foot">
        <span className={`tk-set-apply-hint${saveError ? " tk-set-apply-err" : ""}`}>
          {saveError ?? (dirty ? "Applies to your next brief — today's stays as it is." : "Up to date.")}
        </span>
        <TkButton variant="keep" disabled={!customized || saving} onClick={reset}>
          Reset to defaults
        </TkButton>
        <TkButton variant="act" disabled={!dirty || saving} onClick={apply}>
          {saving ? "Saving…" : "Update my recommendations"}
        </TkButton>
      </div>
    </div>
  )
}
