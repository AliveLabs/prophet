"use client"

// ALT-246 — the client island for the Source Quality queue's triage buttons ("Mark resolved" /
// "Reopen"). Everything else in this route stays a read-only server component (per the ALT-172
// isolation guard); this is the ONLY client boundary, kept as small as the knowledge-review
// pattern it mirrors (app/admin/knowledge-review/components/knowledge-review-table.tsx).
//
// Calls the server action directly (a serializable reference, not an inline function) — RSC-safe,
// doesn't trip `npm run lint:rsc-boundary`.

import { useState, useTransition } from "react"
import { reviewSourceQualityFlag } from "@/app/actions/source-quality-review"
import { TkButton } from "@/components/ticket"
import type { ReviewStatus } from "@/lib/skills/source-quality-review"

export function FlagReviewActions({ flagRef, reviewedStatus }: { flagRef: string; reviewedStatus: ReviewStatus }) {
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)

  function act(action: "resolve" | "reopen") {
    startTransition(async () => {
      const result = await reviewSourceQualityFlag(flagRef, action)
      setFeedback(result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error })
      if (result.ok) setTimeout(() => setFeedback(null), 3000)
    })
  }

  return (
    <div className="sq-acts">
      {reviewedStatus === "open" ? (
        <TkButton
          variant="keep"
          className="sq-btn"
          onClick={() => act("resolve")}
          disabled={isPending}
          aria-label="Mark this flag resolved"
        >
          {isPending ? "Marking resolved…" : "Mark resolved"}
        </TkButton>
      ) : (
        <TkButton
          variant="ghost"
          className="sq-btn"
          onClick={() => act("reopen")}
          disabled={isPending}
          aria-label="Reopen this flag"
        >
          {isPending ? "Reopening…" : "Reopen"}
        </TkButton>
      )}
      {feedback && !feedback.ok && (
        <span className="sq-banner sq-err" role="status">
          {feedback.message}
        </span>
      )}
    </div>
  )
}
