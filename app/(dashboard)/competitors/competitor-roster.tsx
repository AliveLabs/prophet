"use client"

// The Set / Roster — the watched competitive set rebuilt to The Pass.
//
// This REPLACES the legacy <CompetitorList/> presentation (.pv-* rows) with a kit
// roster: branded mark cards in a grid, an add-a-rival flow, and a TkEmptyState CTA
// when the set is empty. The DATA WIRING is identical to the old list — the same
// addCompetitorAction / ignoreCompetitorAction server actions and the same Places
// autocomplete endpoint — only the presentation changes (contract §0/§8).

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  RevealOnView,
  TkCard,
  TkButton,
  TkSectionHead,
  TkEmptyState,
} from "@/components/ticket"
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

// Brand-anchored mark gradients (Ticket palette — no fake imagery; an honest
// monogram tile per rival, scales to any location type).
const MARK_GRADIENTS = [
  "linear-gradient(150deg, var(--slate), var(--slate-2))",
  "linear-gradient(150deg, var(--rust), var(--rust-2))",
  "linear-gradient(150deg, var(--teal), var(--teal-2))",
  "linear-gradient(150deg, var(--gold), var(--gold-2))",
  "linear-gradient(150deg, var(--slate-2), color-mix(in srgb, var(--slate) 70%, #000 30%))",
  "linear-gradient(150deg, var(--rust-2), color-mix(in srgb, var(--rust) 60%, #000 40%))",
]
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}

type Suggestion = { place_id: string; description: string }

const RM_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)
const ADD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export default function CompetitorRoster({
  initial,
  tierLabel,
  competitorLimit,
  hrefBase = "/competitors",
  persist = true,
  locationId,
}: {
  initial: CompetitorRow[]
  tierLabel: string
  /** Max competitors this org's plan allows (ALT-194). When set and reached, the
   *  add affordances disable and relabel. Undefined in preview/unscoped use. */
  competitorLimit?: number
  hrefBase?: string
  persist?: boolean
  locationId?: string
}) {
  const [rows, setRows] = useState<CompetitorRow[]>(initial)
  // ALT-194: when the plan's competitor count is full, gray out / disable adding.
  // No paid add-ons — the cap is simply enforced in the UI (server actions enforce
  // it too). `competitorLimit` is undefined in unscoped/preview use → never blocks.
  const atLimit = competitorLimit != null && rows.length >= competitorLimit
  const limitLabel =
    competitorLimit != null
      ? `Watching ${rows.length} of ${competitorLimit}, set by your plan (${tierLabel})`
      : null
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
    setRows((rs) =>
      rs.some((r) => r.name.toLowerCase() === n.toLowerCase())
        ? rs
        : [...rs, { id: `new-${n}`, name: n, rating: null, reviewCount: null, signalCount: 0, topSignals: [], added: true }]
    )
    setName("")
    setAdding(false)
  }

  // Real add (persist mode): debounced Places autocomplete → pick → server action.
  useEffect(() => {
    if (!persist || !adding) return
    const q = name.trim()
    if (debounce.current) clearTimeout(debounce.current)
    if (q.length < 2) {
      setSuggestions([])
      return
    }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(q)}`)
        const data = (await res.json()) as { ok: boolean; predictions?: Suggestion[] }
        setSuggestions(data.ok ? (data.predictions ?? []).slice(0, 5) : [])
      } catch {
        setSuggestions([])
      }
    }, 300)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
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

  const addPanel = (
    <div className="tk-add-wrap">
      <input
        className="tk-add-input"
        value={name}
        autoFocus
        placeholder={persist ? "Search restaurants near you…" : "Restaurant name…"}
        aria-label="Add a competitor"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !persist) add()
          if (e.key === "Escape") {
            setAdding(false)
            setName("")
          }
        }}
        disabled={pending}
      />
      {persist && name.trim().length >= 2 && suggestions.length ? (
        <ul className="tk-ac-list" role="listbox" aria-label="Matching places">
          {suggestions.map((s) => (
            <li key={s.place_id} role="option" aria-selected="false">
              <button type="button" className="tk-ac-item" onClick={() => pick(s)} disabled={pending}>
                {s.description}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="tk-add-actions">
        {!persist ? (
          <TkButton variant="add" onClick={add} disabled={!name.trim()}>
            Add to the set
          </TkButton>
        ) : null}
        <TkButton
          variant="ghost"
          onClick={() => {
            setAdding(false)
            setName("")
            setSuggestions([])
            setError(null)
          }}
          disabled={pending}
        >
          Cancel
        </TkButton>
      </div>
      {pending ? (
        <p className="tk-note tk-busy">Adding — pulling their data in the background…</p>
      ) : null}
      {error ? <p className="tk-form-err">{error}</p> : null}
    </div>
  )

  return (
    <section className="tk-comp-sec">
      <TkSectionHead
        title="Competitors"
        sub={limitLabel ?? `Watching ${rows.length} · set by your plan (${tierLabel})`}
      />

      {rows.length === 0 && !adding ? (
        <TkEmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 3v18h18" />
              <path d="M7 14l4-4 3 3 5-6" />
            </svg>
          }
          title="No rivals on watch yet"
          description="Add the restaurants you measure yourself against. We track their pricing, reviews, social, and menus, and surface anything that moves into your brief."
          action={
            persist ? (
              <TkButton variant="act" onClick={() => setAdding(true)}>
                {ADD_ICON} Add your first competitor
              </TkButton>
            ) : null
          }
        />
      ) : (
        <RevealOnView className="tk-roster" stagger>
          {rows.map((c, i) => (
            <div key={c.id} style={{ "--tk-i": i } as CSSProperties}>
              <TkCard className={`tk-rost-card${c.added ? " tk-is-new" : ""}`}>
                <div className="tk-rost-top">
                  <span
                    className="tk-rost-mark"
                    style={{ background: MARK_GRADIENTS[i % MARK_GRADIENTS.length] }}
                    aria-hidden="true"
                  >
                    {initials(c.name)}
                  </span>
                  <div className="tk-rost-id">
                    <div className="tk-rost-name">{c.name}</div>
                    {c.rating != null ? (
                      <div className="tk-rost-rating">
                        <span className="tk-star">★</span> {c.rating}
                        {c.reviewCount != null ? ` · ${c.reviewCount.toLocaleString()} reviews` : ""}
                      </div>
                    ) : (
                      <div className="tk-rost-rating">{c.added ? "Added by you" : "Rating pending"}</div>
                    )}
                  </div>
                </div>

                {c.added ? (
                  <p className="tk-rost-quiet">First data pull running — signals appear here shortly.</p>
                ) : c.topSignals.length ? (
                  <div className="tk-rost-signals">
                    <span className="tk-sig-lbl">
                      {c.signalCount} signal{c.signalCount === 1 ? "" : "s"} this month
                    </span>
                    {c.topSignals[0]}
                  </div>
                ) : (
                  <p className="tk-rost-quiet">Quiet this month — nothing has moved into your brief yet.</p>
                )}

                <div className="tk-rost-foot">
                  {c.added ? null : (
                    <Link className="tk-rost-view" href={`${hrefBase}/${c.id}`}>
                      Open profile →
                    </Link>
                  )}
                  {persist && !c.added ? (
                    <form action={ignoreCompetitorAction}>
                      <input type="hidden" name="competitor_id" value={c.id} />
                      <button type="submit" className="tk-rost-rm" aria-label={`Stop watching ${c.name}`}>
                        {RM_ICON}
                      </button>
                    </form>
                  ) : (
                    <button
                      className="tk-rost-rm"
                      onClick={() => removeLocal(c.id)}
                      aria-label={`Remove ${c.name}`}
                    >
                      {RM_ICON}
                    </button>
                  )}
                </div>
              </TkCard>
            </div>
          ))}

          {/* add tile lives in the grid flow */}
          <div style={{ "--tk-i": rows.length } as CSSProperties}>
            {adding ? (
              <TkCard className="tk-rost-card tk-is-new">{addPanel}</TkCard>
            ) : atLimit ? (
              // ALT-194: plan is full — disable adding and relabel with the real numbers.
              <TkCard className="tk-rost-card tk-is-new tk-is-full" style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
                <TkButton variant="add" disabled aria-label={limitLabel ?? "Competitor limit reached"}>
                  {ADD_ICON} {limitLabel}
                </TkButton>
                <p className="tk-rost-quiet" style={{ marginTop: 0 }}>
                  Stop watching one to make room, or upgrade your plan for more.
                </p>
              </TkCard>
            ) : (
              <TkCard className="tk-rost-card tk-is-new" style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
                <TkButton variant="add" onClick={() => setAdding(true)} aria-label="Add a competitor">
                  {ADD_ICON} Add a competitor
                </TkButton>
                <p className="tk-rost-quiet" style={{ marginTop: 0 }}>
                  {persist
                    ? "A new rival's first data pull starts the moment you add them."
                    : "Preview — changes here don't save."}
                </p>
              </TkCard>
            )}
          </div>
        </RevealOnView>
      )}
    </section>
  )
}
