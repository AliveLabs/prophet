"use client"

import { useEffect, useRef, useState } from "react"
import { tkcx as cx } from "./primitives"

// Popover that captures WHY a play was dismissed → a learning signal.
// Positioned absolutely inside its (relative) parent card — Concept A appends it
// at the card's bottom. Renders a small set of reason buttons + a cancel.
//
// ALT-172: a reason listed in `noteReasons` (e.g. "This looks wrong") opens a small
// OPTIONAL free-text box before confirming, so the operator can tell us WHAT looks
// wrong. That note is captured as DATA-QUALITY feedback (it does not reweight the
// model). Other reasons fire onSelect immediately as before.
//
// Controlled by `open`; `onSelect(reason, note?)` fires with the chosen reason (and
// the optional note for a note-capturing reason); `onCancel` dismisses without a choice.
export const TK_DEFAULT_DISMISS_REASONS = [
  "Not relevant to me",
  "Already doing it",
  "This looks wrong",
] as const

export function TkDismissReason({
  open,
  reasons = [...TK_DEFAULT_DISMISS_REASONS],
  noteReasons = ["This looks wrong"],
  notePrompt = "What looks wrong? (optional)",
  notePlaceholder = "e.g. our hours are wrong on Google, the menu price is out of date…",
  heading = "Why dismiss this?",
  onSelect,
  onCancel,
}: {
  open: boolean
  reasons?: string[]
  /** Reasons that open an optional note box before confirming (ALT-172). */
  noteReasons?: string[]
  notePrompt?: string
  notePlaceholder?: string
  heading?: string
  onSelect: (reason: string, note?: string) => void
  onCancel: () => void
}) {
  // mount, then add .tk-open next frame so the transition runs
  const [shown, setShown] = useState(false)
  // when set, we're in the note-capture step for this reason (ALT-172)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      raf.current = requestAnimationFrame(() => setShown(true))
    } else {
      setShown(false)
      // reset the note step whenever the popover closes so it never reopens mid-note
      setNoteFor(null)
      setNote("")
    }
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [open])

  if (!open) return null

  function pick(r: string) {
    if (noteReasons.includes(r)) {
      setNoteFor(r) // reveal the optional note box; confirm sends it
      return
    }
    onSelect(r)
  }

  return (
    <div className={cx("tk-reason", shown && "tk-open")} role="dialog" aria-label={heading}>
      {noteFor ? (
        <>
          <h5>{noteFor}</h5>
          <label className="tk-reason-notelabel" htmlFor="tk-reason-note">
            {notePrompt}
          </label>
          <textarea
            id="tk-reason-note"
            className="tk-reason-note"
            value={note}
            placeholder={notePlaceholder}
            rows={3}
            maxLength={1000}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="tk-opts">
            <button
              type="button"
              className="tk-ropt"
              onClick={() => onSelect(noteFor, note.trim() || undefined)}
            >
              Dismiss
            </button>
          </div>
          <button type="button" className="tk-cancel" onClick={onCancel}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <h5>{heading}</h5>
          <div className="tk-opts">
            {reasons.map((r) => (
              <button
                key={r}
                type="button"
                className="tk-ropt"
                onClick={() => pick(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <button type="button" className="tk-cancel" onClick={onCancel}>
            Cancel
          </button>
        </>
      )}
    </div>
  )
}
