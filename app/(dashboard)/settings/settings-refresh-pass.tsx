"use client"

// Ad-hoc data refresh, rebuilt to The Pass. Same wired behavior as refresh-controls.tsx
// — calls the SAME server actions (refreshLocationAction, refreshSocialNetworkAction)
// against the durable queue, with the same honest "queued, lands in a few minutes"
// feedback. Only the presentation moves to kit tk-set-* controls.
//
// ALT-223: the full "Refresh all data" pull is expensive, so it's rate-limited to once
// per 12h. The button is DISABLED while the cooldown is open and shows when it'll be
// available again (cooldown is derived server-side from the last full-refresh job, and
// re-checked there so a disabled button can't be bypassed). The targeted reruns —
// refresh one social network, refresh social after adding a channel — stay ALWAYS
// available and are styled as buttons with a refresh icon.

import { useEffect, useState, useTransition } from "react"
import { refreshLocationAction, refreshSocialNetworkAction } from "../refresh-actions"
import { TkButton } from "@/components/ticket"

const NETWORKS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
]

// Small refresh glyph — inherits the button's currentColor + the kit's 15px svg sizing.
function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  )
}

/** "available again at 3:40 PM" when within today, otherwise a short date+time. */
function formatAvailableAt(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`
}

export default function SettingsRefreshPass({
  locationId,
  canRunFull = true,
  fullAvailableAt = null,
}: {
  locationId: string
  canRunFull?: boolean
  fullAvailableAt?: string | null
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const [pending, startTransition] = useTransition()

  // Local cooldown mirror so the button flips to disabled the moment a full refresh is
  // queued, and flips back the moment the window passes — without a page reload.
  const [availableAt, setAvailableAt] = useState<string | null>(canRunFull ? null : fullAvailableAt)
  const [now, setNow] = useState(() => Date.now())

  const cooling = availableAt != null && new Date(availableAt).getTime() > now
  useEffect(() => {
    if (!cooling) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [cooling])

  function refreshAll() {
    setStatus(null)
    startTransition(async () => {
      const res = await refreshLocationAction(locationId)
      setErr(!res.ok)
      if (res.ok) {
        setStatus(`Queued ${res.queued} refresh jobs — fresh data lands over the next few minutes.`)
        // Open a local 12h cooldown immediately (server is the source of truth).
        setAvailableAt(new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString())
      } else {
        setStatus(res.error ?? "Could not queue — try again.")
        if (res.availableAt) setAvailableAt(res.availableAt)
      }
    })
  }

  function refreshNetwork(id: string, label: string) {
    setStatus(null)
    startTransition(async () => {
      const res = await refreshSocialNetworkAction(locationId, [id])
      setErr(!res.ok)
      setStatus(res.ok ? `Queued a ${label} refresh — new posts land in a few minutes.` : (res.error ?? "Could not queue — try again."))
    })
  }

  const fullDisabled = pending || cooling

  return (
    <div className="tk-set-fields">
      <div className="tk-set-field">
        <div className="tk-set-flbl">Everything</div>
        <div className="tk-set-fval">
          <div className="tk-set-row-actions">
            <TkButton variant="act" disabled={fullDisabled} onClick={refreshAll}>
              <RefreshIcon />
              {pending ? "Queuing…" : "Refresh all data"}
            </TkButton>
            {cooling && availableAt ? (
              <span className="tk-set-hint">Available again at {formatAvailableAt(availableAt)}.</span>
            ) : null}
          </div>
          <p className="tk-set-hint">
            Re-checks your menu, reviews, competitors, local events, weather, foot traffic, and social —
            then rebuilds your insights. Available once every 12 hours.
          </p>
        </div>
      </div>
      <div className="tk-set-field">
        <div className="tk-set-flbl">One network</div>
        <div className="tk-set-fval">
          <div className="tk-set-row-actions">
            {NETWORKS.map((n) => (
              <TkButton key={n.id} variant="keep" disabled={pending} onClick={() => refreshNetwork(n.id, n.label)}>
                <RefreshIcon />
                {n.label}
              </TkButton>
            ))}
          </div>
          <p className="tk-set-hint">Refresh a single social network without re-pulling everything — always available.</p>
        </div>
      </div>
      {status ? <span className={`tk-set-status${err ? " tk-set-status-err" : ""}`} style={{ marginTop: 8 }}>{status}</span> : null}
    </div>
  )
}
