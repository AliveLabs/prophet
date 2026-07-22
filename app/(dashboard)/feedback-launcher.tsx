"use client"

// ALT-371: the beta "Share feedback" affordance. Lives in the left-nav footer (and, compact,
// in the mobile header) so a beta user can flag "this was good, but…" feedback in context —
// no email, no list. Auto-captures the route they're on; org/user are resolved server-side in
// submitBetaFeedback. Success confirms with a sonner toast (the dashboard's established pattern).

import { useState, useTransition } from "react"
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import { TkDrawer, TkActions, TkButton } from "@/components/ticket"
import { submitBetaFeedback } from "./feedback-actions"
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_MAX_MESSAGE,
  type FeedbackCategory,
} from "@/lib/feedback/feedback"

export default function FeedbackLauncher({
  locationId = null,
  compact = false,
}: {
  locationId?: string | null
  /** Icon-only trigger for the mobile header. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [message, setMessage] = useState("")
  const [pending, startTransition] = useTransition()
  const pathname = usePathname()

  const canSend = message.trim().length > 0 && !pending

  function submit() {
    if (!canSend) return
    startTransition(async () => {
      const res = await submitBetaFeedback({
        message: message.trim(),
        category,
        locationId,
        pagePath: pathname,
      })
      if (res.ok) {
        toast.success("Thanks. We read every one of these.")
        setMessage("")
        setCategory(null)
        setOpen(false)
      } else {
        toast.error(res.error ?? "That didn't send. Please try again.")
      }
    })
  }

  const icon = (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2v-7Z" />
      <path d="M5 6.5h6M5 8.5h4" />
    </svg>
  )

  return (
    <>
      {compact ? (
        <button
          type="button"
          className="pv-fb-btn pv-fb-btn--compact"
          onClick={() => setOpen(true)}
          aria-label="Share feedback"
        >
          {icon}
        </button>
      ) : (
        <button type="button" className="pv-fb-btn" onClick={() => setOpen(true)}>
          {icon}
          <span>Share feedback</span>
        </button>
      )}

      <TkDrawer open={open} onClose={() => setOpen(false)} title="Share feedback" portal>
        <p className="pv-fb__lead">
          What&rsquo;s working? What&rsquo;s missing? Tell us anything. The rough edges help most.
        </p>

        <div className="pv-fb__chips" role="group" aria-label="What kind of feedback?">
          {FEEDBACK_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`pv-fb__chip${category === c ? " is-on" : ""}`}
              aria-pressed={category === c}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {FEEDBACK_CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <textarea
          className="pv-fb__text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={FEEDBACK_MAX_MESSAGE}
          rows={5}
          placeholder="Share what you're seeing…"
          aria-label="Your feedback"
          autoFocus
        />
        <p className="pv-fb__hint">We&rsquo;ll include the page you&rsquo;re on so we can see the context.</p>

        <TkActions>
          <TkButton variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </TkButton>
          <TkButton variant="act" onClick={submit} disabled={!canSend}>
            {pending ? "Sending…" : "Send feedback"}
          </TkButton>
        </TkActions>
      </TkDrawer>
    </>
  )
}
