"use client"

// Roster + invite form for Settings → Team (ALT-457 phase 1). The server owns every rule
// (see lib/team/guards.ts); this mirrors them only to decide what to show, so a hidden
// control and a direct action call fail for the same reason.

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { TkButton } from "@/components/ticket"
// Same pure rule the server action applies, so the button enables exactly when the submit
// would be accepted — no "looks fine, gets rejected" gap.
import { normalizeInviteEmail } from "@/lib/team/guards"
import { inviteTeamMemberAction, removeTeamMemberAction } from "./actions"

export interface TeamMemberRow {
  userId: string
  name: string
  email: string
  role: string
  /** False until they've signed in at least once — shown as "Invited". */
  hasSignedIn: boolean
  isYou: boolean
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

export default function TeamClient({
  members,
  actorRole,
  canInvite,
}: {
  members: TeamMemberRow[]
  actorRole: string
  canInvite: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [email, setEmail] = useState("")

  // Email is the only required field; name is optional and role defaults to Member.
  const canSubmit = normalizeInviteEmail(email) !== null

  const isOwner = actorRole === "owner"
  const canManage = isOwner || actorRole === "admin"
  const ownerCount = members.filter((m) => m.role === "owner").length

  function submitInvite(formData: FormData) {
    setFeedback(null)
    startTransition(async () => {
      const res = await inviteTeamMemberAction(formData)
      setFeedback({ ok: res.ok, msg: res.ok ? (res.message ?? "Invited.") : (res.error ?? "Something went wrong.") })
      if (res.ok) {
        setEmail("")
        router.refresh()
      }
    })
  }

  function remove(userId: string) {
    setFeedback(null)
    setRemovingId(userId)
    startTransition(async () => {
      const res = await removeTeamMemberAction(userId)
      setFeedback({ ok: res.ok, msg: res.ok ? (res.message ?? "Removed.") : (res.error ?? "Something went wrong.") })
      setRemovingId(null)
      if (res.ok) router.refresh()
    })
  }

  /** Mirrors assessRemoval() so we don't offer a control the server will refuse. */
  function canRemove(m: TeamMemberRow): boolean {
    if (!canManage || m.isYou) return false
    if (m.role === "owner") return isOwner && ownerCount > 1
    return true
  }

  return (
    <>
      <div className="tk-set-roster">
        {members.map((m) => (
          <div key={m.userId} className="tk-set-member">
            <span className="tk-set-avatar" aria-hidden="true">
              {(m.name.trim()[0] ?? "?").toUpperCase()}
            </span>
            <span className="tk-set-member-text">
              <b>
                {m.name}
                {m.isYou ? " (you)" : ""}
              </b>
              <span>
                {ROLE_LABEL[m.role] ?? m.role} · {m.email}
              </span>
            </span>
            <span className={`tk-set-member-tag${m.hasSignedIn ? "" : " is-pending"}`}>
              {m.hasSignedIn ? "Active" : "Invited"}
            </span>
            {canRemove(m) ? (
              <button
                type="button"
                className="tk-set-memberx"
                onClick={() => remove(m.userId)}
                disabled={pending && removingId === m.userId}
                aria-label={`Remove ${m.name}`}
              >
                {pending && removingId === m.userId ? "Removing…" : "Remove"}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {feedback ? (
        <p className={`tk-set-feedback${feedback.ok ? " is-ok" : " is-err"}`} role="status">
          {feedback.msg}
        </p>
      ) : null}

      {canManage && canInvite ? (
        <form action={submitInvite} className="tk-set-inviteform">
          <div className="tk-set-invitefields">
            <label className="tk-set-field">
              <span>Email</span>
              <input
                type="email"
                name="email"
                required
                placeholder="name@restaurant.com"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="tk-set-field">
              <span>Name (optional)</span>
              <input type="text" name="fullName" placeholder="First Last" autoComplete="off" />
            </label>
            <label className="tk-set-field">
              <span>Role</span>
              {/* Only an owner may mint an admin — otherwise admin self-propagates and the
                  owner loses track of who holds elevated access. */}
              <select name="role" defaultValue="member">
                <option value="member">Member</option>
                {isOwner ? <option value="admin">Admin</option> : null}
              </select>
            </label>
          </div>
          <TkButton type="submit" variant="act" disabled={pending || !canSubmit}>
            {pending ? "Sending invite…" : "Invite member"}
          </TkButton>
          <p className="tk-set-invitehint">
            They&apos;ll get an email with a sign-in link. No password to set up.
          </p>
        </form>
      ) : null}
    </>
  )
}
