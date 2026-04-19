"use client"

import { useState, useTransition, type FormEvent } from "react"
import { invitePlatformAdmin } from "@/app/actions/admin-management"

export function InviteAdmin() {
  const [email, setEmail] = useState("")
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    startTransition(async () => {
      const result = await invitePlatformAdmin(email)
      setFeedback({
        ok: result.ok,
        message: result.ok ? result.message : result.error,
      })
      if (result.ok) setEmail("")
      setTimeout(() => setFeedback(null), 5000)
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-4 text-sm text-muted-foreground">
        Enter the email address of the person you want to grant admin access.
        If they don&rsquo;t have a Ticket account yet, one will be created
        automatically.
      </p>

      {feedback && (
        <div
          className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
            feedback.ok
              ? "border-precision-teal/30 bg-precision-teal/10 text-precision-teal"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@example.com"
          className="flex-1 rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-vatic-indigo px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Inviting..." : "Invite Admin"}
        </button>
      </form>
    </div>
  )
}
