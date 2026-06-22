"use client"

// Save / Snooze / Dismiss on a play (Batch 5). The server owns the state — after an
// action we router.refresh() so the brief re-renders (cleared plays collapse into the
// "Cleared" strip server-side). Undo deletes the row.

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { setPlayAction } from "./brief-actions"
import type { PlayAction } from "@/lib/insights/momentum"
import type { EnrichedRecommendation } from "@/lib/skills/types"

const LABEL: Record<PlayAction, string> = {
  saved: "Saved",
  snoozed: "Snoozed — back tomorrow",
  dismissed: "Dismissed",
}

export default function PlayActionButtons({
  locationId,
  dateKey,
  playKey,
  current,
  play,
  readOnly = false,
}: {
  locationId: string
  dateKey: string
  playKey: string
  current: PlayAction | null
  /** The full play — passed so a "save" persists reliably even if the live brief was rebuilt
   *  between render and click (P7b: the server otherwise can't find it to persist). */
  play?: EnrichedRecommendation
  readOnly?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function act(action: PlayAction | null) {
    if (readOnly) return
    startTransition(async () => {
      // Only send the (larger) play object on save, where the server needs it to persist.
      const res = await setPlayAction({ locationId, dateKey, playKey, action, play: action === "saved" ? play : undefined })
      if (res.ok) router.refresh()
    })
  }

  if (current) {
    return (
      <span className="pa">
        <span className="pa-state">{LABEL[current]}</span>
        <button type="button" className="pa-btn" disabled={pending} onClick={() => act(null)}>Undo</button>
      </span>
    )
  }

  return (
    <span className="pa">
      <button type="button" className="pa-btn" disabled={pending} onClick={() => act("saved")} aria-label="Save this play">Save</button>
      <button type="button" className="pa-btn" disabled={pending} onClick={() => act("snoozed")} aria-label="Snooze this play">Snooze</button>
      <button type="button" className="pa-btn pa-btn--dismiss" disabled={pending} onClick={() => act("dismissed")} aria-label="Dismiss this play">Dismiss</button>
    </span>
  )
}
