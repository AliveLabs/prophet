"use client"

import { useState, useTransition, type FormEvent } from "react"
import { invitePlatformAdmin } from "@/app/actions/admin-management"
import type { AdminRole } from "@/lib/auth/capabilities"
import { TkButton } from "@/components/ticket"

const ROLE_OPTIONS: { value: AdminRole; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Day-to-day management (no hard-delete, billing, or admin management)" },
  { value: "super_admin", label: "Super Admin", hint: "Full access, including destructive + governance actions" },
  { value: "read_only", label: "Read-only", hint: "View and export only" },
]

export function InviteAdmin() {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<AdminRole>("admin")
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    startTransition(async () => {
      const result = await invitePlatformAdmin(email, role)
      setFeedback({
        ok: result.ok,
        message: result.ok ? result.message : result.error,
      })
      if (result.ok) setEmail("")
      setTimeout(() => setFeedback(null), 5000)
    })
  }

  const roleHint = ROLE_OPTIONS.find((r) => r.value === role)?.hint

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p className="tk-muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
        Enter the email address of the person you want to grant admin access. If
        they don&rsquo;t have a Ticket account yet, one will be created
        automatically.
      </p>

      {feedback && (
        <div className={`adm-flash ${feedback.ok ? "is-ok" : "is-err"}`} role="status">
          {feedback.message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="adm-form-grid">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            className="adm-input"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRole)}
            aria-label="Role"
            className="adm-select"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <TkButton type="submit" variant="add" disabled={isPending}>
            {isPending ? "Inviting…" : "Invite admin"}
          </TkButton>
        </div>
        {roleHint && <p className="adm-rolehint">{roleHint}</p>}
      </form>
    </div>
  )
}
