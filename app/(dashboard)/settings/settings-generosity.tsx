"use client"

// Review Intelligence (ALT-351) — the generosity-threshold slider island. A precise
// clone of settings-brief-tuning.tsx's wiring: useState + appliedValue + dirty +
// useTransition + TkButton variant "keep" apply, same .tk-set-range control family.
// Calls setGenerosityThreshold (settings/actions.ts), which writes
// locations.generosity_threshold — lib/reviews/make-good.ts reads it to place the
// discount/refund cut-points when it maps a scored review to a recommended action.
//
// GUARDRAIL: this is a make-good posture dial only. It never touches review removal
// and this copy never mentions removing or hiding reviews.

import { useState, useTransition } from "react"
import { setGenerosityThreshold } from "./actions"
import { TkButton } from "@/components/ticket"

const BANDS = [
  {
    max: 33,
    label: "Respond first",
    desc: "Ticket leans toward a reply first. A discount or refund only shows up as a last resort, and only for the most serious complaints.",
  },
  {
    max: 66,
    label: "Measured make-goods",
    desc: "Ticket mixes replies with an occasional discount or refund, sized to how serious the complaint is.",
  },
  {
    max: 100,
    label: "Generous",
    desc: "Ticket reaches for a discount or refund more readily on serious complaints, on top of a reply.",
  },
] as const

function bandFor(v: number) {
  return BANDS.find((b) => v <= b.max) ?? BANDS[BANDS.length - 1]
}

export default function SettingsGenerosity({ initial, locationId }: { initial: number; locationId: string }) {
  const [value, setValue] = useState(initial)
  const [appliedValue, setAppliedValue] = useState(initial)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const dirty = value !== appliedValue
  const band = bandFor(value)

  function apply() {
    setSaveError(null)
    startSaving(async () => {
      const res = await setGenerosityThreshold(locationId, value)
      if (!res.ok) {
        setSaveError(res.error ?? "Could not save. Try again.")
        return
      }
      setAppliedValue(value)
    })
  }

  return (
    <div>
      <div className="tk-set-range-head">
        <span className="tk-set-range-val">{band.label}</span>
        <span className="tk-set-range-pct">{value}</span>
      </div>
      <input
        className="tk-set-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label="Make-good comfort level"
        onChange={(e) => setValue(Number(e.target.value))}
      />
      <div className="tk-set-range-ends"><span>Respond first</span><span>Generous</span></div>
      <p className="tk-set-range-note">{band.desc}</p>
      <div className="tk-set-apply-foot">
        {dirty && (
          <TkButton variant="keep" disabled={saving} onClick={apply}>
            {saving ? "Saving…" : "Update my recommendations"}
          </TkButton>
        )}
        <span className={`tk-set-apply-hint${saveError ? " tk-set-apply-err" : ""}`}>
          {saveError ?? (dirty ? "Applies to new suggestions, nothing is sent to customers." : "Up to date.")}
        </span>
      </div>
    </div>
  )
}
