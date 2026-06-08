"use client"

// Brief tuning — lives in Settings (not the brief rail). Per the Chris+Bryan review,
// changes here NEVER silently rewrite today's brief: the operator adjusts, then takes
// an explicit "Update my recommendations" action, which applies to the next brief.
// The slider sets how BROAD vs NARROW the recommendation thresholds are (not "more/
// fewer cards"); "Show everything" is a separate escape hatch that ignores thresholds.
// This is the working shell — persistence + recompute are wired with the authed page.

import { useState } from "react"

const BANDS = [
  { max: 33, label: "Focused", desc: "Only the highest-conviction moves — the ones that clearly fit your brand." },
  { max: 66, label: "Balanced", desc: "A healthy spread. We surface strong plays and hold back only what clearly clashes." },
  { max: 100, label: "Broad", desc: "Widen the net — include exploratory and higher-risk ideas. We'll flag what's a stretch." },
] as const

function bandFor(v: number) {
  return BANDS.find((b) => v <= b.max) ?? BANDS[BANDS.length - 1]
}

export default function BriefTuning({ initial }: { initial: number }) {
  const [value, setValue] = useState(initial)
  const [showAll, setShowAll] = useState(false)
  // last "applied" snapshot — what the next brief would use
  const [appliedValue, setAppliedValue] = useState(initial)
  const [appliedAll, setAppliedAll] = useState(false)

  const dirty = value !== appliedValue || showAll !== appliedAll
  const band = bandFor(value)

  function apply() {
    setAppliedValue(value)
    setAppliedAll(showAll)
    // Real persistence (setBrandTolerance) + recompute are wired on the authed page.
  }

  return (
    <div className="bt">
      <div className="bt__row">
        <span className="bt__val">{showAll ? "Everything" : band.label}</span>
        <span className="bt__pct">{value}</span>
      </div>
      <input
        className="pv-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={showAll}
        aria-label="Idea boldness — recommendation breadth"
        onChange={(e) => setValue(Number(e.target.value))}
      />
      <div className="bt__ends"><span>Narrower</span><span>Broader</span></div>
      <p className="bt__note">
        {showAll
          ? "Showing every recommendation we generate, regardless of threshold. Tighten the slider to get back to a curated brief."
          : band.desc}
      </p>
      <label className="bt__all">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        <span>Show everything — surface every recommendation, no threshold</span>
      </label>
      <div className="bt__foot">
        <button type="button" className="bt__apply" disabled={!dirty} onClick={apply}>
          Update my recommendations
        </button>
        <span className="bt__hint">
          {dirty ? "Applies to your next brief — today's stays as it is." : "Up to date."}
        </span>
      </div>
    </div>
  )
}
