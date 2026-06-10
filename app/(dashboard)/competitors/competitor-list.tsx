"use client"

// Competitor management — this page is the HOME for the watched set (the brief's old
// "On watch" rail moved here). Rows link to a per-competitor detail; REMOVE is wired
// for real (ignoreCompetitorAction, admin-gated, persists); ADD is real too (Batch 3):
// Places autocomplete → addCompetitorAction (insert approved + first-pull enqueued).

import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ignoreCompetitorAction, addCompetitorAction } from "./actions"

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

type Suggestion = { place_id: string; description: string }

export default function CompetitorList({
  initial,
  tierLabel,
  hrefBase = "/competitors",
  persist = true,
  locationId,
}: {
  initial: CompetitorRow[]
  tierLabel: string
  /** Detail-link base — "/competitors" authed, "/preview/competitors" on the preview. */
  hrefBase?: string
  /** When false (preview), add/remove stay local-state only. */
  persist?: boolean
  /** Required for the real add flow (persist mode). */
  locationId?: string
}) {
  const [rows, setRows] = useState<CompetitorRow[]>(initial)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const removeLocal = (id: string) => setRows((rs) => rs.filter((r) => r.id !== id))
  const add = () => {
    const n = name.trim()
    if (!n) return
    setRows((rs) => (rs.some((r) => r.name.toLowerCase() === n.toLowerCase()) ? rs : [...rs, { id: `new-${n}`, name: n, rating: null, reviewCount: null, signalCount: 0, topSignals: [], added: true }]))
    setName("")
    setAdding(false)
  }

  // Real add (persist mode): debounced Places autocomplete → pick → server action.
  useEffect(() => {
    if (!persist || !adding) return
    const q = name.trim()
    if (debounce.current) clearTimeout(debounce.current)
    if (q.length < 2) { setSuggestions([]); return }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(q)}`)
        const data = (await res.json()) as { ok: boolean; predictions?: Suggestion[] }
        setSuggestions(data.ok ? (data.predictions ?? []).slice(0, 5) : [])
      } catch {
        setSuggestions([])
      }
    }, 300)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [name, adding, persist])

  const pick = (s: Suggestion) => {
    if (!locationId) return
    setError(null)
    setSuggestions([])
    startTransition(async () => {
      const res = await addCompetitorAction({ locationId, placeId: s.place_id })
      if (res.ok) {
        setAdding(false)
        setName("")
        router.refresh()
      } else {
        setError(res.error)
      }
    })
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
        <div className="pv-card pv-comp-row pv-comp-row--add" style={{ position: "relative" }}>
          <input
            className="pv-input"
            value={name}
            autoFocus
            placeholder={persist ? "Search restaurants near you…" : "Restaurant name…"}
            aria-label="Add a competitor"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !persist) add() }}
            disabled={pending}
          />
          {persist && suggestions.length ? (
            <ul className="pv-ac__list" role="listbox">
              {suggestions.map((s) => (
                <li key={s.place_id}>
                  <button type="button" className="pv-ac__item" onClick={() => pick(s)} disabled={pending}>{s.description}</button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="pv-comp-row__actions">
            {!persist ? <button className="pv-btn pv-btn--sm" onClick={add} disabled={!name.trim()}>Add</button> : null}
            <button className="pv-btn pv-btn--sm pv-btn--ghost" onClick={() => { setAdding(false); setName(""); setSuggestions([]); setError(null) }} disabled={pending}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="pv-add" onClick={() => setAdding(true)}>+ Add a competitor</button>
      )}
      {pending ? <span className="pv-soon">Adding — pulling their data in the background…</span> : null}
      {error ? <p className="pv-form-error">{error}</p> : null}
      {persist ? (
        <span className="pv-soon">Add and remove save immediately. A new rival&apos;s first data pull starts the moment you add them.</span>
      ) : (
        <span className="pv-soon">Preview — changes here don&apos;t save.</span>
      )}
    </div>
  )
}
