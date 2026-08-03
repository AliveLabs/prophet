"use client"

import { useTransition } from "react"
import { startTrialWithoutCardAction } from "@/app/onboarding/actions"

// The card-less trial start, made reachable from the held-account panel.
//
// It used to exist ONLY as "Skip for now" on /onboarding/trial — one screen, seen
// once. An operator who closed the tab on that step (or was routed past it) could
// never get back: /home reads current_organization_id, finds no live clock, and
// renders the held panel, which offered Stripe checkout and nothing else. This is
// the same server action, so the guards are unchanged, and the caller only renders
// it when the org has never had a clock — so it cannot mint a second free trial.
//
// Not awaited inside startTransition on purpose: the action redirects, and
// redirect() throws, which would strand `pending` forever.
export default function StartTrialWithoutCardButton() {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      className="pv-btn"
      disabled={pending}
      onClick={() => startTransition(() => startTrialWithoutCardAction())}
    >
      {pending ? "Starting your trial…" : "Start 14 days free without a card"}
    </button>
  )
}
