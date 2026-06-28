"use client"

import { useEffect, useRef, useState } from "react"
import { tkcx as cx } from "./primitives"

// Popover that captures WHY a play was dismissed → a learning signal.
// Positioned absolutely inside its (relative) parent card — Concept A appends it
// at the card's bottom. Renders a small set of reason buttons + a cancel.
//
// Controlled by `open`; `onSelect(reason)` fires with the chosen reason, `onCancel`
// dismisses the popover without a choice.
export const TK_DEFAULT_DISMISS_REASONS = [
  "Not relevant to me",
  "Already doing it",
  "This looks wrong",
] as const

export function TkDismissReason({
  open,
  reasons = [...TK_DEFAULT_DISMISS_REASONS],
  heading = "Why dismiss this?",
  onSelect,
  onCancel,
}: {
  open: boolean
  reasons?: string[]
  heading?: string
  onSelect: (reason: string) => void
  onCancel: () => void
}) {
  // mount, then add .tk-open next frame so the transition runs
  const [shown, setShown] = useState(false)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      raf.current = requestAnimationFrame(() => setShown(true))
    } else {
      setShown(false)
    }
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [open])

  if (!open) return null

  return (
    <div className={cx("tk-reason", shown && "tk-open")} role="dialog" aria-label={heading}>
      <h5>{heading}</h5>
      <div className="tk-opts">
        {reasons.map((r) => (
          <button
            key={r}
            type="button"
            className="tk-ropt"
            onClick={() => onSelect(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <button type="button" className="tk-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
