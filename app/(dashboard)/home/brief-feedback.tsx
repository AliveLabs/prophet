"use client"

import { useState, useTransition } from "react"
import { submitPlayFeedback } from "./brief-actions"
import type { Verdict } from "@/lib/skills/preferences"

/** 👍/👎 on a single play. Writes to brief_feedback and tunes future briefs. */
export default function BriefFeedback({
  locationId,
  dateKey,
  playKey,
  severity = 0,
  readOnly = false,
}: {
  locationId: string
  dateKey: string
  playKey: string
  severity?: number
  readOnly?: boolean
}) {
  const [picked, setPicked] = useState<Verdict | null>(null)
  const [, startTransition] = useTransition()

  function vote(verdict: Verdict) {
    if (picked) return
    setPicked(verdict)
    if (readOnly) return
    startTransition(() => {
      void submitPlayFeedback({ locationId, dateKey, playKey, verdict, severity })
    })
  }

  if (picked) {
    return <span className="fb-sent">{picked === "good" ? "Noted — more like this" : "Noted — less like this"}</span>
  }

  return (
    <span className="fb">
      <span className="fb-label">Useful?</span>
      <button type="button" className="fb-btn fb-good" aria-pressed={false} aria-label="Useful" onClick={() => vote("good")}>
        ↑
      </button>
      <button type="button" className="fb-btn fb-bad" aria-pressed={false} aria-label="Not useful" onClick={() => vote("bad")}>
        ↓
      </button>
    </span>
  )
}
