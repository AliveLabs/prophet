"use client"

// Brief tuning, rebuilt to The Pass — same wired behavior as brief-tuning.tsx
// (it calls the SAME server action `setBrandTolerance`, same band logic, same
// "applies to your NEXT brief" contract from the Chris+Bryan review). Only the
// presentation moves to the kit's tk-set-* range/check controls.

import { useState, useTransition } from "react"
import { setBrandTolerance } from "../home/brief-actions"
import { TkButton } from "@/components/ticket"

const BANDS = [
  { max: 33, label: "Focused", desc: "Only the highest-conviction moves — the ones that clearly fit your brand." },
  { max: 66, label: "Balanced", desc: "A healthy spread. We surface strong plays and hold back only what clearly clashes." },
  { max: 100, label: "Broad", desc: "Widen the net — include exploratory and higher-risk ideas. We'll flag what's a stretch." },
] as const

function bandFor(v: number) {
  return BANDS.find((b) => v <= b.max) ?? BANDS[BANDS.length - 1]
}

export default function SettingsBriefTuning({ initial, locationId }: { initial: number; locationId?: string }) {
  const [value, setValue] = useState(initial)
  const [showAll, setShowAll] = useState(false)
  const [appliedValue, setAppliedValue] = useState(initial)
  const [appliedAll, setAppliedAll] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const dirty = value !== appliedValue || showAll !== appliedAll
  const band = bandFor(value)

  function apply() {
    setSaveError(null)
    const toSave = showAll ? 100 : value
    if (locationId) {
      startSaving(async () => {
        const res = await setBrandTolerance(locationId, toSave)
        if (!res.ok) {
          setSaveError(res.error ?? "Could not save — try again.")
          return
        }
        setAppliedValue(value)
        setAppliedAll(showAll)
      })
    } else {
      setAppliedValue(value)
      setAppliedAll(showAll)
    }
  }

  return (
    <div>
      <div className="tk-set-range-head">
        <span className="tk-set-range-val">{showAll ? "Everything" : band.label}</span>
        <span className="tk-set-range-pct">{value}</span>
      </div>
      <input
        className="tk-set-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={showAll}
        aria-label="Idea boldness — recommendation breadth"
        onChange={(e) => setValue(Number(e.target.value))}
      />
      <div className="tk-set-range-ends"><span>Narrower</span><span>Broader</span></div>
      <p className="tk-set-range-note">
        {showAll
          ? "Showing every recommendation we generate, regardless of threshold. Tighten the slider to get back to a curated brief."
          : band.desc}
      </p>
      <label className="tk-set-check">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        <span>Show everything — surface every recommendation, no threshold</span>
      </label>
      <div className="tk-set-apply-foot">
        <TkButton variant="act" disabled={!dirty || saving} onClick={apply}>
          {saving ? "Saving…" : "Update my recommendations"}
        </TkButton>
        <span className={`tk-set-apply-hint${saveError ? " tk-set-apply-err" : ""}`}>
          {saveError ?? (dirty ? "Applies to your next brief — today's stays as it is." : "Up to date.")}
        </span>
      </div>
    </div>
  )
}
