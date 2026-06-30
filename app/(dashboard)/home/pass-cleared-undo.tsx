"use client"

// The Pass — the Undo control inside the "Cleared today" strip.
// Calls the SAME wired server action (setPlayAction with action:null) the old
// PlayActionButtons used for undo — only the presentation changes.

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { TkButton, useTkToast } from "@/components/ticket"
import { setPlayAction } from "./brief-actions"
import { UNDO_ICON } from "./pass-icons"

export function PassClearedUndo({
  locationId,
  dateKey,
  playKey,
  state,
}: {
  locationId: string
  dateKey: string
  playKey: string
  state: "Dismissed" | "Snoozed"
}) {
  const router = useRouter()
  const toast = useTkToast()
  const [pending, startTransition] = useTransition()

  function undo() {
    startTransition(async () => {
      const res = await setPlayAction({ locationId, dateKey, playKey, action: null })
      if (res.ok) {
        toast("Restored to your plays.")
        router.refresh()
      }
    })
  }

  return (
    <span className="pass-cleared-controls">
      <span className="pass-cleared-state">{state}</span>
      <TkButton variant="ghost" disabled={pending} onClick={undo}>
        {UNDO_ICON} Undo
      </TkButton>
    </span>
  )
}
