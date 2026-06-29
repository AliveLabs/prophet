"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  updateUserProfile,
  deactivateUser,
  activateUser,
  sendUserMagicLink,
  impersonateUser,
  deleteUser,
} from "@/app/actions/user-management"
import { sendCustomEmail } from "@/app/actions/admin-email"
import { RevealOnView, TkButton, TkCard } from "@/components/ticket"

interface UserDetail {
  id: string
  email: string
  fullName: string | null
  avatarUrl: string | null
  createdAt: string
  lastSignInAt: string | null
  isBanned: boolean
  provider: string
  hasOnboarded: boolean
  organizations: Array<{
    id: string
    name: string
    role: string
    tier: string
    trialEndsAt: string | null
    joinedAt: string
  }>
  activityLog: Array<{
    id: string
    action: string
    adminEmail: string
    details: Record<string, unknown> | null
    createdAt: string
  }>
}

export function UserDetailClient({ user }: { user: UserDetail }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState("")
  const [showEdit, setShowEdit] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteReason, setDeleteReason] = useState("")

  const handleToggleStatus = () => {
    if (
      !confirm(
        user.isBanned
          ? `Activate ${user.email}?`
          : `Deactivate ${user.email}?`
      )
    )
      return
    startTransition(async () => {
      const result = user.isBanned
        ? await activateUser(user.id)
        : await deactivateUser(user.id)
      setFeedback(result.ok ? result.message : result.error)
    })
  }

  const handleSendMagicLink = () => {
    startTransition(async () => {
      const result = await sendUserMagicLink(user.id)
      setFeedback(result.ok ? result.message : result.error)
    })
  }

  const handleImpersonate = () => {
    const reason = window.prompt(
      `View as ${user.email}? You'll switch to their read-only session (30-min limit, banner, fully audited); "Exit" returns you to sign-in.\n\nReason (required):`
    )
    if (!reason || !reason.trim()) return
    startTransition(async () => {
      const result = await impersonateUser(user.id, reason)
      if (result.ok) {
        window.location.href = "/home" // now the target's session
      } else {
        setFeedback(result.error)
      }
    })
  }

  const handleDelete = () => {
    if (!deleteReason.trim()) return
    startTransition(async () => {
      // The confirm dialog states sole-member orgs will be deleted, so opt into the
      // cascade (deleteUser defaults to 'preserve'). Phase 5 adds a preserve/transfer
      // choice to this UI; until then this preserves the prior delete-button behavior.
      const result = await deleteUser(user.id, { orgStrategy: "cascade", reason: deleteReason })
      if (result.ok) {
        router.push("/admin/users")
      } else {
        setFeedback(result.error)
        setShowDeleteConfirm(false)
        setDeleteReason("")
      }
    })
  }

  const initial = (user.fullName ?? user.email)[0]?.toUpperCase()

  return (
    <div className="ticket-chrome tk-kit ap-page">
      <nav className="ap-crumbs" aria-label="Breadcrumb">
        <Link href="/admin/users">Users</Link>
        <span className="ap-slash" aria-hidden="true">/</span>
        <span className="ap-here">{user.email}</span>
      </nav>

      {feedback && (
        <div className="ap-note ap-note-ok" role="status">
          <span className="ap-dot" aria-hidden="true" />
          {feedback}
        </div>
      )}

      <div className="ap-detail-grid">
        {/* ── MAIN COLUMN ── */}
        <div className="ap-col">
          <RevealOnView>
            <TkCard>
              <div className="ap-profile">
                <div className="ap-profile-id">
                  <div className="ap-avatar" aria-hidden="true">{initial}</div>
                  <div style={{ minWidth: 0 }}>
                    <h2>{user.fullName || user.email}</h2>
                    <p className="ap-email">{user.email}</p>
                  </div>
                </div>
                {user.isBanned ? (
                  <span className="ap-pill ap-pill-bad">
                    <span className="ap-dot" aria-hidden="true" /> Deactivated
                  </span>
                ) : (
                  <span className="ap-pill ap-pill-ok">
                    <span className="ap-dot" aria-hidden="true" /> Active
                  </span>
                )}
              </div>

              <div className="ap-info">
                <InfoItem label="Created" value={new Date(user.createdAt).toLocaleDateString()} />
                <InfoItem
                  label="Last sign in"
                  value={user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : "Never"}
                />
                <InfoItem label="Provider" value={user.provider} />
                <InfoItem label="Onboarded" value={user.hasOnboarded ? "Yes" : "No"} />
              </div>
            </TkCard>
          </RevealOnView>

          {/* action row */}
          <div className="ap-actions-row">
            <TkButton variant="keep" onClick={() => setShowEdit(!showEdit)}>
              Edit profile
            </TkButton>
            <TkButton variant="keep" onClick={handleSendMagicLink} disabled={isPending}>
              Send magic link
            </TkButton>
            <TkButton
              variant="keep"
              onClick={handleImpersonate}
              disabled={isPending}
              style={{ color: "var(--gold-deep)" }}
            >
              Impersonate
            </TkButton>
            <TkButton
              variant="keep"
              onClick={handleToggleStatus}
              disabled={isPending}
              style={{ color: user.isBanned ? "var(--teal-deep)" : "var(--alert-deep)" }}
            >
              {user.isBanned ? "Activate user" : "Deactivate user"}
            </TkButton>
            <TkButton variant="keep" onClick={() => setShowEmail(!showEmail)}>
              Send email
            </TkButton>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isPending}
              className="tk-btn tk-btn-dismiss"
              style={{ color: "var(--alert-deep)", fontWeight: 700 }}
            >
              Delete user
            </button>
          </div>

          {showEdit && (
            <EditProfilePanel
              userId={user.id}
              currentName={user.fullName ?? ""}
              currentEmail={user.email}
              onClose={() => setShowEdit(false)}
            />
          )}

          {showEmail && (
            <SendEmailPanel toEmail={user.email} onClose={() => setShowEmail(false)} />
          )}

          {showDeleteConfirm && (
            <div className="ap-modal-scrim" role="dialog" aria-modal="true" aria-labelledby="del-title">
              <div className="ap-modal">
                <h3 id="del-title">Permanently delete user</h3>
                <p>
                  This will permanently delete <b>{user.email}</b> and all associated data:
                </p>
                <ul>
                  <li>Organizations where they are the sole owner, including all locations, competitors, and insights (any other members lose access too)</li>
                  <li>Their membership in shared organizations</li>
                  <li>Their auth account and profile</li>
                </ul>
                <p className="ap-warn-note">
                  Their waitlist entry will be reset so they can reapply if needed.
                </p>
                <p className="ap-danger-note">This action cannot be undone.</p>
                <input
                  type="text"
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Reason (required, recorded in the audit log)"
                  className="ap-field"
                />
                <div className="ap-modal-foot">
                  <TkButton
                    variant="ghost"
                    onClick={() => {
                      setShowDeleteConfirm(false)
                      setDeleteReason("")
                    }}
                    disabled={isPending}
                  >
                    Cancel
                  </TkButton>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isPending || !deleteReason.trim()}
                    className="tk-btn"
                    style={{
                      background: "linear-gradient(145deg, var(--alert), var(--alert-2))",
                      color: "#fff",
                      opacity: isPending || !deleteReason.trim() ? 0.5 : 1,
                    }}
                  >
                    {isPending ? "Deleting…" : "Delete permanently"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* organizations */}
          <RevealOnView>
            <TkCard>
              <div className="ap-panel-title" style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 800, letterSpacing: "-.01em", marginBottom: 14 }}>
                Organizations
              </div>
              {user.organizations.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  No organization memberships.
                </p>
              ) : (
                <div className="ap-list">
                  {user.organizations.map((org) => (
                    <Link
                      key={org.id}
                      href={`/admin/organizations/${org.id}`}
                      className="ap-listitem"
                    >
                      <div>
                        <span className="ap-li-name">{org.name}</span>
                        <span className="ap-li-role">{org.role}</span>
                      </div>
                      <div className="ap-li-side">
                        <span className="ap-tag-soft ap-tag" style={{ textTransform: "capitalize" }}>
                          {org.tier}
                        </span>
                        <span>Joined {new Date(org.joinedAt).toLocaleDateString()}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </TkCard>
          </RevealOnView>
        </div>

        {/* ── SIDE RAIL ── */}
        <div className="ap-col">
          <RevealOnView>
            <TkCard>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 800, letterSpacing: "-.01em", marginBottom: 14 }}>
                Admin activity
              </div>
              {user.activityLog.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--ink-2)" }}>No activity logged yet.</p>
              ) : (
                <div className="ap-timeline">
                  {user.activityLog.map((log) => (
                    <div key={log.id} className="ap-tl-item">
                      <p className="ap-tl-act">{log.action.replace(/\./g, " → ")}</p>
                      <p className="ap-tl-meta">
                        by {log.adminEmail} · {new Date(log.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </TkCard>
          </RevealOnView>
        </div>
      </div>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="ap-i-lbl">{label}</p>
      <p className="ap-i-val">{value}</p>
    </div>
  )
}

function EditProfilePanel({
  userId,
  currentName,
  currentEmail,
  onClose,
}: {
  userId: string
  currentName: string
  currentEmail: string
  onClose: () => void
}) {
  const [fullName, setFullName] = useState(currentName)
  const [email, setEmail] = useState(currentEmail)
  const [feedback, setFeedback] = useState("")
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const updates: { fullName?: string; email?: string } = {}
      if (fullName !== currentName) updates.fullName = fullName
      if (email !== currentEmail) updates.email = email
      if (Object.keys(updates).length === 0) {
        setFeedback("No changes to save.")
        return
      }
      const result = await updateUserProfile(userId, updates)
      setFeedback(result.ok ? result.message : result.error)
      if (result.ok) setTimeout(onClose, 1200)
    })
  }

  return (
    <div className="ap-inline-form">
      <div className="ap-inline-form-head">
        <h3>Edit profile</h3>
        <button onClick={onClose} className="ap-link" style={{ color: "var(--ink-3)" }}>
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="ap-fieldset">
        <div className="ap-frow ap-2">
          <div>
            <label className="ap-flabel">Full name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="ap-field"
            />
          </div>
          <div>
            <label className="ap-flabel">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="ap-field"
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <TkButton type="submit" variant="act" disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </TkButton>
          {feedback && <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{feedback}</span>}
        </div>
      </form>
    </div>
  )
}

function SendEmailPanel({
  toEmail,
  onClose,
}: {
  toEmail: string
  onClose: () => void
}) {
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [feedback, setFeedback] = useState("")
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const result = await sendCustomEmail(toEmail, subject, body)
      setFeedback(result.ok ? result.message : result.error)
      if (result.ok) {
        setSubject("")
        setBody("")
        setTimeout(onClose, 1500)
      }
    })
  }

  return (
    <div className="ap-inline-form">
      <div className="ap-inline-form-head">
        <h3>Send email to {toEmail}</h3>
        <button onClick={onClose} className="ap-link" style={{ color: "var(--ink-3)" }}>
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="ap-fieldset">
        <div>
          <label className="ap-flabel">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            className="ap-field"
          />
        </div>
        <div>
          <label className="ap-flabel">Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={4}
            className="ap-textarea"
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <TkButton type="submit" variant="act" disabled={isPending}>
            {isPending ? "Sending…" : "Send email"}
          </TkButton>
          {feedback && <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{feedback}</span>}
        </div>
      </form>
    </div>
  )
}
