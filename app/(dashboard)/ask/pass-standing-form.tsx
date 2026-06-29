"use client"

// The Pass — standing-question form, rebuilt to the kit. DATA FLOW unchanged from
// the original standing-form.tsx: pin / update / clear the one Ask that re-runs every
// morning after the brief precompute, via the wired setStandingQuestion server action.
// Only presentation is rebuilt (the field + buttons use the Pass ask surface).

import { useState, useTransition } from "react"
import { TkButton } from "@/components/ticket"
import { setStandingQuestion } from "./actions"

export default function PassStandingForm({
  locationId,
  current,
}: {
  locationId: string
  current: string | null
}) {
  const [q, setQ] = useState(current ?? "")
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save(next: string) {
    setError(null)
    startTransition(async () => {
      const res = await setStandingQuestion(locationId, next)
      if (!res.ok) setError(res.error ?? "Couldn't save — try again.")
      else if (!next) setQ("")
    })
  }

  const unchanged = q.trim() === (current ?? "")

  return (
    <div>
      <div className="tkask-sform">
        <div className="tkask-field">
          <input
            className="tkask-input"
            type="text"
            value={q}
            placeholder="Pin a question to re-run every morning…"
            aria-label="Standing question"
            enterKeyHint="done"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) save(q) }}
          />
        </div>
        <TkButton
          variant="act"
          onClick={() => save(q)}
          disabled={pending || !q.trim() || unchanged}
        >
          {pending ? "Saving…" : current ? "Update" : "Pin it"}
        </TkButton>
        {current ? (
          <TkButton variant="dismiss" onClick={() => save("")} disabled={pending}>
            Unpin
          </TkButton>
        ) : null}
      </div>
      {error ? <p className="tkask-form-error" role="alert">{error}</p> : null}
    </div>
  )
}
