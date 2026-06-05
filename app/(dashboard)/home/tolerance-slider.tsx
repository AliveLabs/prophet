"use client"

import { useRef, useState, useTransition } from "react"
import { setBrandTolerance } from "./brief-actions"

function band(v: number): { label: string; note: string } {
  if (v <= 33) return { label: "Tame", note: "On-brand only. We hold back anything that could feel off for your place." }
  if (v >= 67) return { label: "Adventurous", note: "Show me the bold ideas, even the risky ones. I'll tell you what doesn't fit." }
  return { label: "Balanced", note: "A healthy mix. We drop only the plays that clearly clash with your brand." }
}

/** Brand-tolerance slider (0 tame .. 100 adventurous). Debounced save to the location. */
export default function ToleranceSlider({ locationId, initial, readOnly = false }: { locationId: string; initial: number; readOnly?: boolean }) {
  const [value, setValue] = useState(initial)
  const [, startTransition] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const b = band(value)

  function onChange(next: number) {
    setValue(next)
    if (readOnly) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      startTransition(() => {
        void setBrandTolerance(locationId, next)
      })
    }, 450)
  }

  return (
    <div className="tol">
      <div className="tol__row">
        <span className="b-label" style={{ fontFamily: "var(--font-cond)", textTransform: "uppercase", letterSpacing: ".12em", fontSize: 11, color: "var(--ash)" }}>
          Idea boldness
        </span>
        <span className="tol__val">{b.label}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label="Brand tolerance"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="tol__ends">
        <span>Tame</span>
        <span>Adventurous</span>
      </div>
      <p className="tol__note">{b.note}</p>
    </div>
  )
}
