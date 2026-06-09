"use client"

// Competitor management — this page is the HOME for the watched set (the brief's old
// "On watch" rail moved here). Rows link to a per-competitor detail; REMOVE is wired
// for real (ignoreCompetitorAction, admin-gated, persists); ADD is honest about not
// saving yet (full add/discovery lands with the reworked onboarding flow).

import { useState } from "react"
import Link from "next/link"
import { ignoreCompetitorAction } from "./actions"

export type CompetitorRow = {
  id: string
  name: string
  rating: number | null
  reviewCount: number | null
  signalCount: number
  topSignals: string[]
  added?: boolean
}

const MARK_COLORS = ["#3D4F5F", "#B85C38", "#3A8066", "#C9942A", "#6E6862", "#8A3D20"]
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}

export default function CompetitorList({
  initial,
  tierLabel,
  hrefBase = "/competitors",
  persist = true,
}: {
  initial: CompetitorRow[]
  tierLabel: string
  /** Detail-link base — "/competitors" authed, "/preview/competitors" on the preview. */
  hrefBase?: string
  /** When false (preview), remove stays local-state only. */
  persist?: boolean
}) {
  const [rows, setRows] = useState<CompetitorRow[]>(initial)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")

  const removeLocal = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id))
  const add = () => {
    const n = name.trim()
    if (!n) return
    setRows((rs) => (rs.some((r) => r.name.toLowerCase() === n.toLowerCase()) ? rs : [...rs, { id: `new-${n}`, name: n, rating: null, reviewCount: null, signalCount: 0, topSignals: [], added: true }]))
    setName("")
    setAdding(false)
  }

  return (
    <div className="pv-section">
      <div className="pv-section-head">
        Watching <span className="count">{rows.length}</span>
        <span className="pv-section-sub">set by your plan ({tierLabel})</span>
      </div>

      {rows.map((c, i) => (
        <div className="pv-card pv-comp-row" key={c.id}>
          <span className="pv-comp__mark" style={{ background: MARK_COLORS[i % MARK_COLORS.length] }}>{initials(c.name)}</span>
          <div className="pv-comp-row__body">
            <div className="pv-comp__name">{c.name}</div>
            <div className="pv-comp__meta">
              {c.rating != null ? <>★ {c.rating}{c.reviewCount != null ? ` · ${c.reviewCount.toLocaleString()} reviews` : ""} · </> : null}
              {c.added ? "Added by you" : `${c.signalCount} signal${c.signalCount === 1 ? "" : "s"} this month`}
            </div>
          </div>
          <div className="pv-comp-row__actions">
            {c.added ? null : <Link className="pv-link" href={`${hrefBase}/${c.id}`}>View</Link>}
            {persist && !c.added ? (
              <form action={ignoreCompetitorAction}>
                <input type="hidden" name="competitor_id" value={c.id} />
                <button type="submit" className="pv-comp__remove" aria-label={`Remove ${c.name}`}>Remove</button>
              </form>
            ) : (
              <button className="pv-comp__remove" onClick={() => removeLocal(c.id)} aria-label={`Remove ${c.name}`}>Remove</button>
            )}
          </div>
        </div>
      ))}

      {adding ? (
        <div className="pv-card pv-comp-row pv-comp-row--add">
          <input className="pv-input" value={name} autoFocus placeholder="Restaurant name…" aria-label="Add a competitor" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add() }} />
          <div className="pv-comp-row__actions">
            <button className="pv-btn pv-btn--sm" onClick={add} disabled={!name.trim()}>Add</button>
            <button className="pv-btn pv-btn--sm pv-btn--ghost" onClick={() => { setAdding(false); setName("") }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="pv-add" onClick={() => setAdding(true)}>+ Add a competitor</button>
      )}
      <span className="pv-soon">Removing saves immediately. Adding here doesn&apos;t save yet — full add-with-discovery lands with the reworked onboarding.</span>
    </div>
  )
}
