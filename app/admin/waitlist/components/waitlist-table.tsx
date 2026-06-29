"use client"

import { useState, useTransition, useMemo } from "react"
import {
  approveWaitlistSignup,
  declineWaitlistSignup,
  batchApproveWaitlistSignups,
  batchDeclineWaitlistSignups,
  resendWaitlistInvite,
  unapproveWaitlistSignup,
} from "@/app/actions/waitlist"
import { TkButton } from "@/components/ticket"

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

const searchIcon = (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="7" cy="7" r="5" />
    <path d="m11 11 3.5 3.5" strokeLinecap="round" />
  </svg>
)

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

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "ap-pill-warn",
    approved: "ap-pill-ok",
    declined: "ap-pill-bad",
  }
  return (
    <span className={`ap-pill ${map[status] ?? "ap-pill-neutral"}`}>
      <span className="ap-dot" aria-hidden="true" />
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
  const [unapproveReason, setUnapproveReason] = useState("")
  const [showBatchConfirm, setShowBatchConfirm] = useState<
    "approve" | "decline" | null
  >(null)
  const [showUnapprove, setShowUnapprove] = useState<string | null>(null)

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

  function handleUnapprove(id: string) {
    if (!unapproveReason.trim()) return
    startTransition(async () => {
      const result = await unapproveWaitlistSignup(id, unapproveReason)
      setFeedback(result.ok ? result.message : result.error)
      setShowUnapprove(null)
      setUnapproveReason("")
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

  function fullName(s: WaitlistSignup) {
    return [s.first_name, s.last_name].filter(Boolean).join(" ") || "—"
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {feedback && (
        <div className="ap-note ap-note-ok" role="status">
          <span className="ap-dot" aria-hidden="true" />
          {feedback}
        </div>
      )}

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
            aria-label="Search signups"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="ap-select"
          style={{ width: "auto", minWidth: 150 }}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
        </select>
        <span className="ap-spacer" />
        <a
          href="/api/admin/export/waitlist"
          className="tk-btn tk-btn-keep"
        >
          <ExportGlyph /> Export CSV
        </a>
      </div>

      {/* selection / batch bar */}
      {selected.size > 0 && (
        <div className="ap-selbar">
          <span className="ap-sel-n">{selected.size} selected</span>
          <button
            onClick={() => setShowBatchConfirm("approve")}
            disabled={isPending}
            className="ap-mini ap-mini-ok"
          >
            Approve all
          </button>
          <button
            onClick={() => setShowBatchConfirm("decline")}
            disabled={isPending}
            className="ap-mini ap-mini-bad"
          >
            Decline all
          </button>
          <span className="ap-spacer" />
          <button onClick={clearSelection} className="ap-link" style={{ color: "var(--ink-3)" }}>
            Clear
          </button>
        </div>
      )}

      {/* DESKTOP/TABLET: table */}
      <div className="ap-panel">
        <div className="ap-panel-head">
          <span>
            {filtered.length} signup{filtered.length !== 1 ? "s" : ""}
          </span>
          {pendingFiltered.length > 0 && (
            <button onClick={selectAllPending} className="ap-ph-link">
              Select all pending ({pendingFiltered.length})
            </button>
          )}
        </div>
        <div className="ap-tablewrap">
          <table className="ap-table">
            <thead>
              <tr>
                <th style={{ width: 40 }} aria-label="Select" />
                <th>Email</th>
                <th>Name</th>
                <th>Status</th>
                <th>Signed up</th>
                <th>Reviewed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="ap-empty-row">
                  <td colSpan={7}>No signups found.</td>
                </tr>
              ) : (
                filtered.map((signup) => (
                  <tr key={signup.id}>
                    <td>
                      {signup.status === "pending" && (
                        <input
                          type="checkbox"
                          checked={selected.has(signup.id)}
                          onChange={() => toggleSelect(signup.id)}
                          className="ap-check"
                          aria-label={`Select ${signup.email}`}
                        />
                      )}
                    </td>
                    <td className="ap-cell-strong">{signup.email}</td>
                    <td className="ap-cell-muted">{fullName(signup)}</td>
                    <td>
                      <StatusPill status={signup.status} />
                    </td>
                    <td className="ap-cell-mono">{timeAgo(signup.created_at)}</td>
                    <td className="ap-cell-mono">
                      {signup.reviewed_at ? timeAgo(signup.reviewed_at) : "—"}
                    </td>
                    <td>
                      <RowActions
                        signup={signup}
                        isPending={isPending}
                        onApprove={() => handleApprove(signup.id)}
                        onDecline={() => setShowDeclineDialog(signup.id)}
                        onResend={() => handleResendInvite(signup.id)}
                        onUnapprove={() => setShowUnapprove(signup.id)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MOBILE: stacked cards */}
      <div className="ap-cards">
        {filtered.length === 0 ? (
          <div className="ap-rowcard" style={{ textAlign: "center", color: "var(--ink-3)" }}>
            No signups found.
          </div>
        ) : (
          filtered.map((signup) => (
            <div key={signup.id} className="ap-rowcard">
              <div className="ap-rowcard-top">
                <div style={{ minWidth: 0, display: "flex", gap: 10, alignItems: "flex-start" }}>
                  {signup.status === "pending" && (
                    <input
                      type="checkbox"
                      checked={selected.has(signup.id)}
                      onChange={() => toggleSelect(signup.id)}
                      className="ap-check"
                      style={{ marginTop: 2 }}
                      aria-label={`Select ${signup.email}`}
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className="ap-rowcard-title">{signup.email}</div>
                    {fullName(signup) !== "—" ? (
                      <div className="ap-cell-muted" style={{ fontSize: 13 }}>{fullName(signup)}</div>
                    ) : null}
                  </div>
                </div>
                <StatusPill status={signup.status} />
              </div>
              <div className="ap-rowcard-meta">
                <span>Signed up <b>{timeAgo(signup.created_at)}</b></span>
                <span>Reviewed <b>{signup.reviewed_at ? timeAgo(signup.reviewed_at) : "—"}</b></span>
              </div>
              <RowActions
                signup={signup}
                isPending={isPending}
                onApprove={() => handleApprove(signup.id)}
                onDecline={() => setShowDeclineDialog(signup.id)}
                onResend={() => handleResendInvite(signup.id)}
                onUnapprove={() => setShowUnapprove(signup.id)}
              />
            </div>
          ))
        )}
      </div>

      {showDeclineDialog && (
        <Dialog
          title="Decline signup"
          onCancel={() => {
            setShowDeclineDialog(null)
            setDeclineNotes("")
          }}
          onConfirm={() => handleDecline(showDeclineDialog)}
          isPending={isPending}
          confirmLabel="Decline"
          tone="alert"
        >
          <p>
            This will send a polite notification email. The user can reapply later.
          </p>
          <textarea
            value={declineNotes}
            onChange={(e) => setDeclineNotes(e.target.value)}
            placeholder="Internal notes (optional, not sent to user)…"
            rows={3}
            className="ap-textarea"
          />
        </Dialog>
      )}

      {showBatchConfirm === "approve" && (
        <Dialog
          title={`Approve ${selected.size} signup${selected.size > 1 ? "s" : ""}?`}
          onCancel={() => setShowBatchConfirm(null)}
          onConfirm={handleBatchApprove}
          isPending={isPending}
          confirmLabel="Approve all"
          tone="teal"
        >
          <p>
            This will create auth accounts, organizations with 14-day trials, and send
            invitation emails to all selected signups.
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
          confirmLabel="Decline all"
          tone="alert"
        >
          <p>Decline emails will be sent. Users can reapply later.</p>
          <textarea
            value={declineNotes}
            onChange={(e) => setDeclineNotes(e.target.value)}
            placeholder="Internal notes (optional)…"
            rows={2}
            className="ap-textarea"
          />
        </Dialog>
      )}

      {showUnapprove && (
        <Dialog
          title="Un-approve signup?"
          onCancel={() => {
            setShowUnapprove(null)
            setUnapproveReason("")
          }}
          onConfirm={() => handleUnapprove(showUnapprove)}
          isPending={isPending}
          confirmDisabled={!unapproveReason.trim()}
          confirmLabel="Un-approve"
          tone="alert"
        >
          <p>
            Reverts the signup to <b>pending</b>, deletes the organization created on
            approval (and its data), and removes the auto-created account if it owns no
            other orgs. The original invite email can&rsquo;t be unsent, but its link will
            lead nowhere.
          </p>
          <input
            type="text"
            value={unapproveReason}
            onChange={(e) => setUnapproveReason(e.target.value)}
            placeholder="Reason (required, recorded in the audit log)"
            className="ap-field"
          />
        </Dialog>
      )}
    </div>
  )
}

function RowActions({
  signup,
  isPending,
  onApprove,
  onDecline,
  onResend,
  onUnapprove,
}: {
  signup: WaitlistSignup
  isPending: boolean
  onApprove: () => void
  onDecline: () => void
  onResend: () => void
  onUnapprove: () => void
}) {
  if (signup.status === "pending") {
    return (
      <div className="ap-rowactions">
        <button onClick={onApprove} disabled={isPending} className="ap-mini ap-mini-ok">
          Approve
        </button>
        <button onClick={onDecline} disabled={isPending} className="ap-mini ap-mini-bad">
          Decline
        </button>
      </div>
    )
  }
  if (signup.status === "approved") {
    return (
      <div className="ap-rowactions">
        <button onClick={onResend} disabled={isPending} className="ap-mini ap-mini-slate">
          Resend invite
        </button>
        <button onClick={onUnapprove} disabled={isPending} className="ap-mini ap-mini-slate">
          Un-approve
        </button>
      </div>
    )
  }
  if (signup.admin_notes) {
    return (
      <span
        className="ap-cell-muted"
        style={{ fontSize: 12 }}
        title={signup.admin_notes}
      >
        Has notes
      </span>
    )
  }
  return null
}

function Dialog({
  title,
  children,
  onCancel,
  onConfirm,
  isPending,
  confirmLabel,
  tone,
  confirmDisabled = false,
}: {
  title: string
  children: React.ReactNode
  onCancel: () => void
  onConfirm: () => void
  isPending: boolean
  confirmLabel: string
  tone: "teal" | "alert"
  confirmDisabled?: boolean
}) {
  const grad =
    tone === "teal"
      ? "linear-gradient(145deg, var(--teal), var(--teal-2))"
      : "linear-gradient(145deg, var(--alert), var(--alert-2))"
  return (
    <div className="ap-modal-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ap-modal">
        <h3>{title}</h3>
        {children}
        <div className="ap-modal-foot">
          <TkButton variant="ghost" onClick={onCancel} disabled={isPending}>
            Cancel
          </TkButton>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending || confirmDisabled}
            className="tk-btn"
            style={{
              background: grad,
              color: "#fff",
              opacity: isPending || confirmDisabled ? 0.5 : 1,
            }}
          >
            {isPending ? "Processing…" : confirmLabel}
          </button>
        </div>
      </div>
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
