"use client"

import { useState, useTransition, useMemo } from "react"
import {
  approveWaitlistSignup,
  declineWaitlistSignup,
  batchApproveWaitlistSignups,
  batchDeclineWaitlistSignups,
  resendWaitlistInvite,
} from "@/app/actions/waitlist"

interface WaitlistSignup {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  status: string
  source: string
  admin_notes: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-signal-gold/15 text-signal-gold",
    approved: "bg-precision-teal/15 text-precision-teal",
    declined: "bg-destructive/15 text-destructive",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${styles[status] ?? "bg-secondary text-muted-foreground"}`}
    >
      {status}
    </span>
  )
}

export function WaitlistTable({ signups }: { signups: WaitlistSignup[] }) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [showDeclineDialog, setShowDeclineDialog] = useState<string | null>(null)
  const [declineNotes, setDeclineNotes] = useState("")
  const [showBatchConfirm, setShowBatchConfirm] = useState<
    "approve" | "decline" | null
  >(null)

  const filtered = useMemo(() => {
    return signups.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const name = [s.first_name, s.last_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!s.email.includes(q) && !name.includes(q)) return false
      }
      return true
    })
  }, [signups, search, statusFilter])

  const pendingFiltered = filtered.filter((s) => s.status === "pending")

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllPending() {
    setSelected(new Set(pendingFiltered.map((s) => s.id)))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function handleResendInvite(id: string) {
    startTransition(async () => {
      const result = await resendWaitlistInvite(id)
      setFeedback(result.ok ? result.message : result.error)
      setTimeout(() => setFeedback(null), 4000)
    })
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      const result = await approveWaitlistSignup(id)
      setFeedback(result.ok ? result.message : result.error)
      setTimeout(() => setFeedback(null), 4000)
    })
  }

  function handleDecline(id: string) {
    startTransition(async () => {
      const result = await declineWaitlistSignup(id, declineNotes || undefined)
      setFeedback(result.ok ? result.message : result.error)
      setShowDeclineDialog(null)
      setDeclineNotes("")
      setTimeout(() => setFeedback(null), 4000)
    })
  }

  function handleBatchApprove() {
    startTransition(async () => {
      const ids = Array.from(selected)
      const { results } = await batchApproveWaitlistSignups(ids)
      const ok = results.filter((r) => r.ok).length
      const fail = results.filter((r) => !r.ok).length
      setFeedback(`Approved ${ok}${fail > 0 ? `, ${fail} failed` : ""}`)
      setSelected(new Set())
      setShowBatchConfirm(null)
      setTimeout(() => setFeedback(null), 4000)
    })
  }

  function handleBatchDecline() {
    startTransition(async () => {
      const ids = Array.from(selected)
      const { results } = await batchDeclineWaitlistSignups(
        ids,
        declineNotes || undefined
      )
      const ok = results.filter((r) => r.ok).length
      const fail = results.filter((r) => !r.ok).length
      setFeedback(`Declined ${ok}${fail > 0 ? `, ${fail} failed` : ""}`)
      setSelected(new Set())
      setShowBatchConfirm(null)
      setDeclineNotes("")
      setTimeout(() => setFeedback(null), 4000)
    })
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <div className="rounded-lg border border-precision-teal/30 bg-precision-teal/10 px-4 py-2.5 text-sm text-precision-teal">
          {feedback}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-input bg-background px-3.5 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-input bg-background px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
          <span className="text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <button
            onClick={() => setShowBatchConfirm("approve")}
            disabled={isPending}
            className="rounded-md bg-precision-teal/15 px-3 py-1.5 text-xs font-semibold text-precision-teal hover:bg-precision-teal/25 disabled:opacity-50"
          >
            Approve All
          </button>
          <button
            onClick={() => setShowBatchConfirm("decline")}
            disabled={isPending}
            className="rounded-md bg-destructive/15 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/25 disabled:opacity-50"
          >
            Decline All
          </button>
          <button
            onClick={clearSelection}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="text-xs font-semibold text-foreground">
            {filtered.length} signup{filtered.length !== 1 ? "s" : ""}
          </span>
          {pendingFiltered.length > 0 && (
            <button
              onClick={selectAllPending}
              className="text-xs text-vatic-indigo hover:underline"
            >
              Select all pending ({pendingFiltered.length})
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-secondary text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Signed Up</th>
                <th className="px-4 py-3">Reviewed</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    No signups found.
                  </td>
                </tr>
              ) : (
                filtered.map((signup) => (
                  <tr
                    key={signup.id}
                    className="transition-colors hover:bg-secondary/40"
                  >
                    <td className="px-4 py-3">
                      {signup.status === "pending" && (
                        <input
                          type="checkbox"
                          checked={selected.has(signup.id)}
                          onChange={() => toggleSelect(signup.id)}
                          className="h-4 w-4 rounded border-border accent-vatic-indigo"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {signup.email}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {[signup.first_name, signup.last_name]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={signup.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {timeAgo(signup.created_at)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {signup.reviewed_at ? timeAgo(signup.reviewed_at) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {signup.status === "pending" && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleApprove(signup.id)}
                            disabled={isPending}
                            className="rounded-md bg-precision-teal/15 px-2.5 py-1 text-xs font-semibold text-precision-teal hover:bg-precision-teal/25 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setShowDeclineDialog(signup.id)}
                            disabled={isPending}
                            className="rounded-md bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive/25 disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      )}
                      {signup.status === "approved" && (
                        <button
                          onClick={() => handleResendInvite(signup.id)}
                          disabled={isPending}
                          className="rounded-md bg-vatic-indigo/15 px-2.5 py-1 text-xs font-semibold text-vatic-indigo hover:bg-vatic-indigo/25 disabled:opacity-50"
                        >
                          Resend Invite
                        </button>
                      )}
                      {signup.status !== "pending" && signup.admin_notes && (
                        <span
                          className="ml-2 text-xs text-muted-foreground"
                          title={signup.admin_notes}
                        >
                          Has notes
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showDeclineDialog && (
        <Dialog
          title="Decline Signup"
          onCancel={() => {
            setShowDeclineDialog(null)
            setDeclineNotes("")
          }}
          onConfirm={() => handleDecline(showDeclineDialog)}
          isPending={isPending}
          confirmLabel="Decline"
          confirmClass="bg-destructive text-white hover:bg-destructive/90"
        >
          <p className="mb-3 text-sm text-muted-foreground">
            This will send a polite notification email. The user can reapply
            later.
          </p>
          <textarea
            value={declineNotes}
            onChange={(e) => setDeclineNotes(e.target.value)}
            placeholder="Internal notes (optional, not sent to user)..."
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Dialog>
      )}

      {showBatchConfirm === "approve" && (
        <Dialog
          title={`Approve ${selected.size} signup${selected.size > 1 ? "s" : ""}?`}
          onCancel={() => setShowBatchConfirm(null)}
          onConfirm={handleBatchApprove}
          isPending={isPending}
          confirmLabel="Approve All"
          confirmClass="bg-precision-teal text-white hover:bg-precision-teal/90"
        >
          <p className="text-sm text-muted-foreground">
            This will create auth accounts, organizations with 14-day trials,
            and send invitation emails to all selected signups.
          </p>
        </Dialog>
      )}

      {showBatchConfirm === "decline" && (
        <Dialog
          title={`Decline ${selected.size} signup${selected.size > 1 ? "s" : ""}?`}
          onCancel={() => {
            setShowBatchConfirm(null)
            setDeclineNotes("")
          }}
          onConfirm={handleBatchDecline}
          isPending={isPending}
          confirmLabel="Decline All"
          confirmClass="bg-destructive text-white hover:bg-destructive/90"
        >
          <p className="mb-3 text-sm text-muted-foreground">
            Decline emails will be sent. Users can reapply later.
          </p>
          <textarea
            value={declineNotes}
            onChange={(e) => setDeclineNotes(e.target.value)}
            placeholder="Internal notes (optional)..."
            rows={2}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Dialog>
      )}
    </div>
  )
}

function Dialog({
  title,
  children,
  onCancel,
  onConfirm,
  isPending,
  confirmLabel,
  confirmClass,
}: {
  title: string
  children: React.ReactNode
  onCancel: () => void
  onConfirm: () => void
  isPending: boolean
  confirmLabel: string
  confirmClass: string
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-foreground">{title}</h3>
        {children}
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 ${confirmClass}`}
          >
            {isPending ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
