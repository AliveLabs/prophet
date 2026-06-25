"use client"

// Keep / Remove on a play. (Replaced Save/Snooze/Dismiss per the 2026-06-24 Bryan+Chris review.)
//   KEEP   → stored as `saved`: a positive learning signal + persists the play so it doesn't vanish
//            on the next brief refresh ("I want to do this later"). Stays in the active stack.
//   REMOVE → stored as `dismissed`: visibility only — collapses into the "Cleared" strip and keeps a
//            cross-day cooldown so it won't regenerate. NOT a learning signal (see feedback-signals).
// Snooze is retired (Keep covers "do it later"). The DB still allows the legacy values, so LABEL keeps
// a `snoozed` entry purely to render any pre-existing rows. The server owns state — after an action we
// router.refresh() so the brief re-renders. Undo deletes the row.

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { setPlayAction } from "./brief-actions"
import type { PlayAction } from "@/lib/insights/momentum"
import type { EnrichedRecommendation } from "@/lib/skills/types"

const LABEL: Record<PlayAction, string> = {
  saved: "Kept",
  snoozed: "Snoozed", // legacy rows only — no longer emitted
  dismissed: "Removed",
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

  function act(action: "saved" | "dismissed" | null) {
    if (readOnly) return
    startTransition(async () => {
      // Only send the (larger) play object on Keep (saved), where the server needs it to persist.
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
      <button type="button" className="pa-btn" disabled={pending} onClick={() => act("saved")} aria-label="Keep this play">Keep</button>
      <button type="button" className="pa-btn" disabled={pending} onClick={() => act("dismissed")} aria-label="Remove this play">Remove</button>
    </span>
  )
}
