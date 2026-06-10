"use client"

// Pin / update / clear the standing question — the one Ask that re-runs every
// morning after the brief precompute.

import { useState, useTransition } from "react"
import { setStandingQuestion } from "./actions"

export default function StandingForm({
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

  return (
    <div className="pv-standing-form">
      <div className="pv-ask-input">
        <input
          type="text"
          value={q}
          placeholder="Pin a question to re-run every morning…"
          aria-label="Standing question"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) save(q) }}
        />
        <button className="pv-btn pv-btn--sm" onClick={() => save(q)} disabled={pending || !q.trim() || q.trim() === (current ?? "")}>
          {pending ? "Saving…" : current ? "Update" : "Pin it"}
        </button>
        {current ? (
          <button className="pv-btn pv-btn--sm pv-btn--ghost" onClick={() => save("")} disabled={pending}>
            Unpin
          </button>
        ) : null}
      </div>
      {error ? <p className="pv-form-error">{error}</p> : null}
    </div>
  )
}
