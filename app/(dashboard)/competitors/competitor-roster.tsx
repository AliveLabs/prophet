"use client"

// The Set / Roster — the watched competitive set rebuilt to The Pass.
//
// This REPLACES the legacy <CompetitorList/> presentation (.pv-* rows) with a kit
// roster: branded mark cards in a grid, an add-a-rival flow, and a TkEmptyState CTA
// when the set is empty. Adding (persist mode) opens the CompetitorAddDrawer —
// search + neighborhood suggestions in one focused slide-over — instead of the
// old cramped in-card typeahead. Preview mode keeps the simple local input.

import { useState, type CSSProperties } from "react"
import Link from "next/link"
import {
  RevealOnView,
  TkCard,
  TkButton,
  TkSectionHead,
  TkEmptyState,
} from "@/components/ticket"
import { ignoreCompetitorAction } from "./actions"
import CompetitorAddDrawer, { type SuggestedCompetitor } from "./competitor-add-drawer"

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


const RM_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" />
  </svg>
)
const ADD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/** ALT-195 — serializable swap-cooldown state from the server (computeSwapCooldown). */
type SwapCooldown = { locked: boolean; unlocksAt: string | null; daysRemaining: number }

export default function CompetitorRoster({
  initial,
  tierLabel,
  competitorLimit,
  hrefBase = "/competitors",
  persist = true,
  locationId,
  locationGeo,
  addSuggestions,
  swapCooldown,
  swapCooldownDays = 30,
}: {
  initial: CompetitorRow[]
  tierLabel: string
  /** Max competitors this org's plan allows (ALT-194). When set and reached, the
   *  add affordances disable and relabel. Undefined in preview/unscoped use. */
  competitorLimit?: number
  hrefBase?: string
  persist?: boolean
  locationId?: string
  /** Biases the add-competitor search to the neighborhood and puts a distance
   *  on each result. Undefined in preview/unscoped use. */
  locationGeo?: { lat: number; lng: number } | null
  /** Pending discovery candidates for the add drawer's "Suggested for you". */
  addSuggestions?: SuggestedCompetitor[]
  /** ALT-195 — when locked, removing (and thus swapping) is blocked + warned. */
  swapCooldown?: SwapCooldown
  swapCooldownDays?: number
}) {
  const [rows, setRows] = useState<CompetitorRow[]>(initial)
  // Adds land server-side (drawer → addCompetitorAction → router.refresh) while
  // this component instance stays mounted — re-sync local rows when the server
  // sends a fresh set (render-time derived state, per the React docs pattern).
  const [prevInitial, setPrevInitial] = useState(initial)
  if (prevInitial !== initial) {
    setPrevInitial(initial)
    setRows(initial)
  }
  // ALT-194: when the plan's competitor count is full, gray out / disable adding.
  // No paid add-ons — the cap is simply enforced in the UI (server actions enforce
  // it too). `competitorLimit` is undefined in unscoped/preview use → never blocks.
  const atLimit = competitorLimit != null && rows.length >= competitorLimit
  // ALT-195 — persisted removes are disabled while the swap cooldown is active.
  // ALT-261 — but ONLY when the set is at the plan cap: the cooldown exists to bind a
  // true SWAP (remove-then-readd at capacity). Below the cap a removal just frees a
  // slot and isn't a swap, so it must never be blocked (this was disabling every
  // removal, most visibly on Tier 2/3 which sit below cap far more often).
  const swapLocked = persist && atLimit && !!swapCooldown?.locked
  const limitLabel =
    competitorLimit != null
      ? `Watching ${rows.length} of ${competitorLimit}, set by your plan (${tierLabel})`
      : null
  // persist mode: `adding` opens the drawer. Preview mode: `adding` shows the
  // simple local input (nothing saves there).
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")

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

  // Preview-only inline add (no Places, no server).
  const addPanel = (
    <div className="tk-add-wrap">
      <input
        className="tk-add-input"
        value={name}
        autoFocus
        placeholder="Restaurant name…"
        aria-label="Add a competitor"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add()
          if (e.key === "Escape") {
            setAdding(false)
            setName("")
          }
        }}
      />
      <div className="tk-add-actions">
        <TkButton variant="add" onClick={add} disabled={!name.trim()}>
          Add to the set
        </TkButton>
        <TkButton
          variant="ghost"
          onClick={() => {
            setAdding(false)
            setName("")
          }}
        >
          Cancel
        </TkButton>
      </div>
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
                    <div className="tk-rost-name">
                      {/* ALT-192: the name itself links to the detail page (in addition
                          to the "Open profile" footer link), unless it's an unsaved
                          just-added row whose real id doesn't exist yet. */}
                      {c.added ? c.name : (
                        <Link href={`${hrefBase}/${c.id}`} className="tk-comp-link">
                          {c.name}
                        </Link>
                      )}
                    </div>
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
                    <form
                      action={ignoreCompetitorAction}
                      onSubmit={(e) => {
                        // ALT-195: block + warn when the swap cooldown is active; otherwise
                        // confirm, since removing starts a 30-day swap lock.
                        if (swapLocked) {
                          e.preventDefault()
                          return
                        }
                        if (
                          !window.confirm(
                            `Stop watching ${c.name}?\n\nYou can swap a competitor once every ${swapCooldownDays} days — removing this one locks your set for ${swapCooldownDays} days.`
                          )
                        ) {
                          e.preventDefault()
                        }
                      }}
                    >
                      <input type="hidden" name="competitor_id" value={c.id} />
                      <button
                        type="submit"
                        className="tk-rost-rm"
                        disabled={swapLocked}
                        aria-label={
                          swapLocked
                            ? `Swapping is locked for ${swapCooldown?.daysRemaining} more days`
                            : `Stop watching ${c.name}`
                        }
                        title={
                          swapLocked
                            ? `Locked for ${swapCooldown?.daysRemaining} more day${swapCooldown?.daysRemaining === 1 ? "" : "s"} — one swap per ${swapCooldownDays} days`
                            : `Stop watching ${c.name}`
                        }
                      >
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
            {adding && !persist ? (
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

      {persist && locationId ? (
        <CompetitorAddDrawer
          open={adding}
          onClose={() => setAdding(false)}
          locationId={locationId}
          locationGeo={locationGeo}
          initialSuggestions={addSuggestions ?? []}
          watchedCount={rows.length}
          competitorLimit={competitorLimit}
          tierLabel={tierLabel}
        />
      ) : null}
    </section>
  )
}
