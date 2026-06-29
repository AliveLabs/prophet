"use client"

// Ad-hoc data refresh, rebuilt to The Pass. Same wired behavior as refresh-controls.tsx
// — calls the SAME server actions (refreshLocationAction, refreshSocialNetworkAction)
// against the durable queue, with the same honest "queued, lands in a few minutes"
// feedback. Only the presentation moves to kit tk-set-* controls.

import { useState, useTransition } from "react"
import { refreshLocationAction, refreshSocialNetworkAction } from "../refresh-actions"
import { TkButton } from "@/components/ticket"

const NETWORKS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
]

export default function SettingsRefreshPass({ locationId }: { locationId: string }) {
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  const [pending, startTransition] = useTransition()

  function refreshAll() {
    setStatus(null)
    startTransition(async () => {
      const res = await refreshLocationAction(locationId)
      setErr(!res.ok)
      setStatus(res.ok ? `Queued ${res.queued} refresh jobs — fresh data lands over the next few minutes.` : (res.error ?? "Could not queue — try again."))
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

  return (
    <div className="tk-set-fields">
      <div className="tk-set-field">
        <div className="tk-set-flbl">Everything</div>
        <div className="tk-set-fval">
          <div className="tk-set-row-actions">
            <TkButton variant="act" disabled={pending} onClick={refreshAll}>
              {pending ? "Queuing…" : "Refresh all data"}
            </TkButton>
          </div>
          <p className="tk-set-hint">
            Re-checks your menu, reviews, competitors, local events, weather, foot traffic, and social —
            then rebuilds your insights.
          </p>
        </div>
      </div>
      <div className="tk-set-field">
        <div className="tk-set-flbl">One network</div>
        <div className="tk-set-fval">
          <div className="tk-set-row-actions">
            {NETWORKS.map((n) => (
              <TkButton key={n.id} variant="keep" disabled={pending} onClick={() => refreshNetwork(n.id, n.label)}>
                {n.label}
              </TkButton>
            ))}
          </div>
          <p className="tk-set-hint">Refresh a single social network without re-pulling everything.</p>
        </div>
      </div>
      {status ? <span className={`tk-set-status${err ? " tk-set-status-err" : ""}`} style={{ marginTop: 8 }}>{status}</span> : null}
    </div>
  )
}
