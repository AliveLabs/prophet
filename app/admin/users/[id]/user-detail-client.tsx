"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import {
  updateUserProfile,
  deactivateUser,
  activateUser,
  sendUserMagicLink,
  impersonateUser,
} from "@/app/actions/user-management"
import { sendCustomEmail } from "@/app/actions/admin-email"

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
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState("")
  const [showEdit, setShowEdit] = useState(false)
  const [showEmail, setShowEmail] = useState(false)

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
    if (!confirm(`Sign in as ${user.email}? This will be logged.`)) return
    startTransition(async () => {
      const result = await impersonateUser(user.id)
      if (result.ok) {
        window.open(result.url, "_blank")
      } else {
        setFeedback(result.error)
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/users" className="hover:text-foreground">
          Users
        </Link>
        <span>/</span>
        <span className="text-foreground">{user.email}</span>
      </div>

      {feedback && (
        <div className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground">
          {feedback}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-vatic-indigo/10 text-xl font-bold text-vatic-indigo">
                  {(user.fullName ?? user.email)[0]?.toUpperCase()}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {user.fullName || user.email}
                  </h2>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
              {user.isBanned ? (
                <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                  Deactivated
                </span>
              ) : (
                <span className="rounded-full bg-precision-teal/10 px-3 py-1 text-xs font-medium text-precision-teal">
                  Active
                </span>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <InfoItem label="Created" value={new Date(user.createdAt).toLocaleDateString()} />
              <InfoItem
                label="Last Sign In"
                value={user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString() : "Never"}
              />
              <InfoItem label="Provider" value={user.provider} />
              <InfoItem label="Onboarded" value={user.hasOnboarded ? "Yes" : "No"} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowEdit(!showEdit)}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              Edit Profile
            </button>
            <button
              onClick={handleSendMagicLink}
              disabled={isPending}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Send Magic Link
            </button>
            <button
              onClick={handleImpersonate}
              disabled={isPending}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-signal-gold hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Impersonate
            </button>
            <button
              onClick={handleToggleStatus}
              disabled={isPending}
              className={`h-9 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50 ${
                user.isBanned
                  ? "bg-precision-teal/10 text-precision-teal hover:bg-precision-teal/20"
                  : "bg-destructive/10 text-destructive hover:bg-destructive/20"
              }`}
            >
              {user.isBanned ? "Activate User" : "Deactivate User"}
            </button>
            <button
              onClick={() => setShowEmail(!showEmail)}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              Send Email
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
            <SendEmailPanel
              toEmail={user.email}
              onClose={() => setShowEmail(false)}
            />
          )}

          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Organizations
            </h3>
            {user.organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No organization memberships.
              </p>
            ) : (
              <div className="space-y-2">
                {user.organizations.map((org) => (
                  <Link
                    key={org.id}
                    href={`/admin/organizations/${org.id}`}
                    className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-secondary/30 transition-colors"
                  >
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        {org.name}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {org.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground capitalize">
                        {org.tier}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Joined {new Date(org.joinedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Admin Activity
            </h3>
            {user.activityLog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity logged yet.</p>
            ) : (
              <div className="space-y-3">
                {user.activityLog.map((log) => (
                  <div
                    key={log.id}
                    className="border-l-2 border-border pl-3 py-1"
                  >
                    <p className="text-xs font-medium text-foreground">
                      {log.action.replace(/\./g, " → ")}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      by {log.adminEmail} ·{" "}
                      {new Date(log.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Edit Profile</h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-medium text-white hover:bg-vatic-indigo/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Saving..." : "Save Changes"}
          </button>
          {feedback && <span className="text-xs text-muted-foreground">{feedback}</span>}
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Send Email to {toEmail}
        </h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={4}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-medium text-white hover:bg-vatic-indigo/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Sending..." : "Send Email"}
          </button>
          {feedback && <span className="text-xs text-muted-foreground">{feedback}</span>}
        </div>
      </form>
    </div>
  )
}
