"use client"

import { useId, useState, type ReactNode } from "react"
import { tkcx as cx } from "./primitives"

// "Why we're confident ▾" rolldown. Uses the grid-template-rows:0fr→1fr accordion
// technique (animates height with no fixed pixel value). Info-i badge + chevron;
// aria-expanded on the toggle, aria-controls → panel id.
export function TkWhy({
  label = "Why we're confident",
  points,
  source,
  defaultOpen = false,
  className,
}: {
  label?: ReactNode
  /** bullet points; each gets a check (or info) glyph */
  points: ReactNode[]
  /** the dashed "Sources: …" footer */
  source?: ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <div className={cx("tk-why", className)}>
      <button
        type="button"
        className="tk-why-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="tk-info-i" aria-hidden="true">i</span>
        {label}
        <span className="tk-chev" aria-hidden="true">▾</span>
      </button>
      <div className={cx("tk-why-panel", open && "tk-open")} id={panelId}>
        <div>
          <div className="tk-why-inner">
            <ul>
              {points.map((p, i) => (
                <li key={i}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {p}
                </li>
              ))}
            </ul>
            {source && <div className="tk-src">{source}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
