"use client"

import { useTransition } from "react"
import { startTrialWithoutCardAction } from "../actions"

// The secondary path on the card step: start the 14-day trial with no card.
// Deliberately quiet next to "Start my free trial": collecting a card at signup
// converts far better, so this reduces friction without becoming the default.
// The action redirects to /home on success, so there is no success state here;
// pending state exists because the update + redirect is a round trip.
export default function SkipCardButton() {
  const [pending, startTransition] = useTransition()

  return (
    <div className="ob-cardskip">
      <button
        type="button"
        className="ob-skipbtn"
        disabled={pending}
        onClick={() => startTransition(() => startTrialWithoutCardAction())}
      >
        {pending ? "Starting your trial…" : "Skip for now, add a card later"}
      </button>
    </div>
  )
}
