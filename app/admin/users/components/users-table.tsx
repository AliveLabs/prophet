"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import {
  deactivateUser,
  activateUser,
  inviteNewUser,
} from "@/app/actions/user-management"
import { TkButton } from "@/components/ticket"

interface UserRow {
  id: string
  email: string
  fullName: string | null
  createdAt: string
  lastSignInAt: string | null
  isBanned: boolean
  orgCount: number
  hasOnboarded: boolean
  isAdmin: boolean
}

const searchIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="7" cy="7" r="5" />
    <path d="m11 11 3.5 3.5" strokeLinecap="round" />
  </svg>
)

export function UsersTable({ users }: { users: UserRow[] }) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | "deactivated">("all")
  const [tab, setTab] = useState<"users" | "admins">("users")
  const [showInvite, setShowInvite] = useState(false)
  const [isPending, startTransition] = useTransition()

  const adminCount = users.filter((u) => u.isAdmin).length
  const base = tab === "admins" ? users.filter((u) => u.isAdmin) : users

  const filtered = base.filter((u) => {
    const matchesSearch =
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.fullName ?? "").toLowerCase().includes(search.toLowerCase())

    if (filter === "active") return matchesSearch && !u.isBanned
    if (filter === "deactivated") return matchesSearch && u.isBanned
    return matchesSearch
  })

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* segmented tabs */}
      <div className="ap-tabs" role="tablist" aria-label="User scope">
        <button
          role="tab"
          aria-selected={tab === "users"}
          onClick={() => setTab("users")}
          className={`ap-tab${tab === "users" ? " ap-tab-on" : ""}`}
        >
          Users <span className="ap-tab-n">{users.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "admins"}
          onClick={() => setTab("admins")}
          className={`ap-tab${tab === "admins" ? " ap-tab-on" : ""}`}
        >
          Platform admins <span className="ap-tab-n">{adminCount}</span>
        </button>
      </div>

      {/* toolbar */}
      <div className="ap-toolbar">
        <div className="ap-search ap-grow">
          <span className="ap-search-ic" aria-hidden="true">{searchIcon}</span>
          <input
            type="text"
            placeholder="Search by email or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ap-field"
            aria-label="Search users"
          />
        </div>

        <select
          value={filter}
          onChange={(e) =>
            setFilter(e.target.value as "all" | "active" | "deactivated")
          }
          className="ap-select"
          style={{ width: "auto", minWidth: 150 }}
          aria-label="Filter by status"
        >
          <option value="all">All users</option>
          <option value="active">Active</option>
          <option value="deactivated">Deactivated</option>
        </select>

        <span className="ap-spacer" />

        <TkButton variant="add" onClick={() => setShowInvite(true)}>
          Invite user
        </TkButton>
        <a href="/api/admin/export/users" className="tk-btn tk-btn-keep">
          <ExportGlyph /> Export CSV
        </a>
      </div>

      {showInvite && (
        <InviteUserPanel
          onClose={() => setShowInvite(false)}
          isPending={isPending}
          startTransition={startTransition}
        />
      )}

      {/* DESKTOP/TABLET: table */}
      <div className="ap-panel">
        <div className="ap-panel-head">
          <span>
            {filtered.length} {tab === "admins" ? "admin" : "user"}
            {filtered.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="ap-tablewrap">
          <table className="ap-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Status</th>
                <th>Last sign in</th>
                <th>Orgs</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <UserTableRow
                  key={user.id}
                  user={user}
                  isPending={isPending}
                  startTransition={startTransition}
                />
              ))}
              {filtered.length === 0 && (
                <tr className="ap-empty-row">
                  <td colSpan={7}>No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MOBILE: stacked cards */}
      <div className="ap-cards">
        {filtered.length === 0 ? (
          <div className="ap-rowcard" style={{ textAlign: "center", color: "var(--ink-3)" }}>
            No users found.
          </div>
        ) : (
          filtered.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              isPending={isPending}
              startTransition={startTransition}
            />
          ))
        )}
      </div>
    </div>
  )
}

function StatusPill({ banned }: { banned: boolean }) {
  return banned ? (
    <span className="ap-pill ap-pill-bad">
      <span className="ap-dot" aria-hidden="true" /> Deactivated
    </span>
  ) : (
    <span className="ap-pill ap-pill-ok">
      <span className="ap-dot" aria-hidden="true" /> Active
    </span>
  )
}

function RowActions({
  user,
  isPending,
  startTransition,
}: {
  user: UserRow
  isPending: boolean
  startTransition: (fn: () => void) => void
}) {
  const handleToggle = () => {
    if (
      !confirm(
        user.isBanned
          ? `Activate ${user.email}?`
          : `Deactivate ${user.email}? They will be locked out.`
      )
    )
      return
    startTransition(async () => {
      if (user.isBanned) {
        await activateUser(user.id)
      } else {
        await deactivateUser(user.id)
      }
    })
  }

  return (
    <div className="ap-rowactions">
      <Link href={`/admin/users/${user.id}`} className="ap-link">
        View
      </Link>
      <button
        onClick={handleToggle}
        disabled={isPending}
        className={`ap-link ${user.isBanned ? "ap-link-teal" : "ap-link-alert"}`}
      >
        {user.isBanned ? "Activate" : "Deactivate"}
      </button>
    </div>
  )
}

function UserTableRow({
  user,
  isPending,
  startTransition,
}: {
  user: UserRow
  isPending: boolean
  startTransition: (fn: () => void) => void
}) {
  return (
    <tr>
      <td>
        <span className="ap-cell-strong">{user.email}</span>
        {user.isAdmin && <span className="ap-tag" style={{ marginLeft: 8 }}>Admin</span>}
      </td>
      <td className="ap-cell-muted">{user.fullName || "—"}</td>
      <td>
        <StatusPill banned={user.isBanned} />
      </td>
      <td className="ap-cell-mono">
        {user.lastSignInAt ? timeAgo(user.lastSignInAt) : "Never"}
      </td>
      <td className="ap-cell-mono">{user.orgCount}</td>
      <td className="ap-cell-mono">{new Date(user.createdAt).toLocaleDateString()}</td>
      <td>
        <RowActions user={user} isPending={isPending} startTransition={startTransition} />
      </td>
    </tr>
  )
}

function UserCard({
  user,
  isPending,
  startTransition,
}: {
  user: UserRow
  isPending: boolean
  startTransition: (fn: () => void) => void
}) {
  return (
    <div className="ap-rowcard">
      <div className="ap-rowcard-top">
        <div style={{ minWidth: 0 }}>
          <div className="ap-rowcard-title">
            {user.email}
            {user.isAdmin && <span className="ap-tag" style={{ marginLeft: 8 }}>Admin</span>}
          </div>
          {user.fullName ? (
            <div className="ap-cell-muted" style={{ fontSize: 13 }}>{user.fullName}</div>
          ) : null}
        </div>
        <StatusPill banned={user.isBanned} />
      </div>
      <div className="ap-rowcard-meta">
        <span>Last <b>{user.lastSignInAt ? timeAgo(user.lastSignInAt) : "never"}</b></span>
        <span>Orgs <b>{user.orgCount}</b></span>
        <span>Joined <b>{new Date(user.createdAt).toLocaleDateString()}</b></span>
      </div>
      <RowActions user={user} isPending={isPending} startTransition={startTransition} />
    </div>
  )
}

function InviteUserPanel({
  onClose,
  isPending,
  startTransition,
}: {
  onClose: () => void
  isPending: boolean
  startTransition: (fn: () => void) => void
}) {
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [feedback, setFeedback] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const result = await inviteNewUser(email, fullName || undefined)
      if (result.ok) {
        setFeedback(result.message)
        setEmail("")
        setFullName("")
        setTimeout(onClose, 1500)
      } else {
        setFeedback(result.error)
      }
    })
  }

  return (
    <div className="ap-inline-form">
      <div className="ap-inline-form-head">
        <h3>Invite new user</h3>
        <button onClick={onClose} className="ap-link" style={{ color: "var(--ink-3)" }}>
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="ap-fieldset">
        <div className="ap-frow ap-2">
          <div>
            <label className="ap-flabel">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="ap-field"
            />
          </div>
          <div>
            <label className="ap-flabel">Full name (optional)</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="ap-field"
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <TkButton type="submit" variant="act" disabled={isPending}>
            {isPending ? "Sending…" : "Send invite"}
          </TkButton>
          {feedback && (
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{feedback}</span>
          )}
        </div>
      </form>
    </div>
  )
}

function ExportGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 15, height: 15 }} aria-hidden="true">
      <path d="M8 2v8M8 10 5 7M8 10l3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 11v2A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" strokeLinecap="round" />
    </svg>
  )
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  )
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}
