"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import {
  deactivateUser,
  activateUser,
  inviteNewUser,
} from "@/app/actions/user-management"

interface UserRow {
  id: string
  email: string
  fullName: string | null
  createdAt: string
  lastSignInAt: string | null
  isBanned: boolean
  orgCount: number
  hasOnboarded: boolean
}

export function UsersTable({ users }: { users: UserRow[] }) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | "deactivated">("all")
  const [showInvite, setShowInvite] = useState(false)
  const [isPending, startTransition] = useTransition()

  const filtered = users.filter((u) => {
    const matchesSearch =
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.fullName ?? "").toLowerCase().includes(search.toLowerCase())

    if (filter === "active") return matchesSearch && !u.isBanned
    if (filter === "deactivated") return matchesSearch && u.isBanned
    return matchesSearch
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-72 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
        />

        <select
          value={filter}
          onChange={(e) =>
            setFilter(e.target.value as "all" | "active" | "deactivated")
          }
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
        >
          <option value="all">All Users</option>
          <option value="active">Active</option>
          <option value="deactivated">Deactivated</option>
        </select>

        <button
          onClick={() => setShowInvite(true)}
          className="ml-auto h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-medium text-white hover:bg-vatic-indigo/90 transition-colors"
        >
          Invite User
        </button>

        <a
          href="/api/admin/export/users"
          className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors inline-flex items-center"
        >
          Export CSV
        </a>
      </div>

      {showInvite && (
        <InviteUserPanel
          onClose={() => setShowInvite(false)}
          isPending={isPending}
          startTransition={startTransition}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left">
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Email
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Name
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Last Sign In
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Orgs
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Created
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((user) => (
              <UserTableRow
                key={user.id}
                user={user}
                isPending={isPending}
                startTransition={startTransition}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
    <tr className="hover:bg-secondary/30 transition-colors">
      <td className="px-4 py-3 font-medium text-foreground">{user.email}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {user.fullName || "—"}
      </td>
      <td className="px-4 py-3">
        {user.isBanned ? (
          <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
            Deactivated
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-precision-teal/10 px-2 py-0.5 text-xs font-medium text-precision-teal">
            Active
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {user.lastSignInAt ? timeAgo(user.lastSignInAt) : "Never"}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{user.orgCount}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/users/${user.id}`}
            className="text-xs font-medium text-vatic-indigo hover:underline"
          >
            View
          </Link>
          <button
            onClick={handleToggle}
            disabled={isPending}
            className={`text-xs font-medium hover:underline disabled:opacity-50 ${
              user.isBanned ? "text-precision-teal" : "text-destructive"
            }`}
          >
            {user.isBanned ? "Activate" : "Deactivate"}
          </button>
        </div>
      </td>
    </tr>
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Invite New User
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-9 w-60 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Full Name (optional)
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="h-9 w-48 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-medium text-white hover:bg-vatic-indigo/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Sending..." : "Send Invite"}
        </button>
        {feedback && (
          <span className="text-xs text-muted-foreground">{feedback}</span>
        )}
      </form>
    </div>
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
