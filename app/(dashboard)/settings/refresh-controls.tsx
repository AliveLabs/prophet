"use client"

// Ad-hoc data refresh — wired to the durable queue (Stage A). "Refresh everything"
// enqueues all data pipelines for this business; per-network buttons refresh just
// that social network. Honest feedback: jobs are QUEUED and drain within minutes —
// the UI never pretends the work is instant.

import { useState, useTransition } from "react"
import { refreshLocationAction, refreshSocialNetworkAction } from "../refresh-actions"

const NETWORKS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "tiktok", label: "TikTok" },
]

export default function RefreshControls({ locationId }: { locationId: string }) {
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function refreshAll() {
    setStatus(null)
    startTransition(async () => {
      const res = await refreshLocationAction(locationId)
      setStatus(res.ok ? `Queued ${res.queued} refresh jobs — fresh data lands over the next few minutes.` : res.error)
    })
  }

  function refreshNetwork(id: string, label: string) {
    setStatus(null)
    startTransition(async () => {
      const res = await refreshSocialNetworkAction(locationId, [id])
      setStatus(res.ok ? `Queued a ${label} refresh — new posts land in a few minutes.` : res.error)
    })
  }

  return (
    <div className="pv-card">
      <div className="pv-field">
        <div className="pv-field__label">Everything</div>
        <div className="pv-field__val">
          <button type="button" className="pv-btn pv-btn--sm" disabled={pending} onClick={refreshAll}>
            {pending ? "Queuing…" : "Refresh all data"}
          </button>
          <div className="pv-field__hint">Re-checks your menu, reviews, competitors, local events, weather, foot traffic, and social — then rebuilds your insights.</div>
        </div>
      </div>
      <div className="pv-field">
        <div className="pv-field__label">One network</div>
        <div className="pv-field__val">
          {NETWORKS.map((n) => (
            <button key={n.id} type="button" className="pv-btn pv-btn--sm pv-btn--ghost" style={{ marginRight: 8 }} disabled={pending} onClick={() => refreshNetwork(n.id, n.label)}>
              {n.label}
            </button>
          ))}
          <div className="pv-field__hint">Refresh a single social network without re-pulling everything.</div>
        </div>
      </div>
      {status ? <span className="pv-soon">{status}</span> : null}
    </div>
  )
}
