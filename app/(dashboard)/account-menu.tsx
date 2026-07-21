"use client"

import { useState, useRef, useEffect, useMemo, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signOutAction, switchOrganizationAction } from "./actions"
import type { AccountLocation } from "./operator-data"

/** Consistent auto-initials: first letters of the first two SIGNIFICANT words → up to 2
 *  chars. "Sugar Bacon" → "SB", "The Rusty Spoon" → "RS" (skips leading articles), "Cane's"
 *  → "C". Falls back to the first two letters of a single-word name. */
function initials(s: string): string {
  const skip = new Set(["the", "a", "an", "of", "and", "&"])
  const words = s
    .split(/[\s\-–—]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
  const significant = words.filter((w) => !skip.has(w.toLowerCase()))
  const pool = significant.length ? significant : words
  if (pool.length >= 2) return (pool[0][0] + pool[1][0]).toUpperCase()
  if (pool.length === 1) return pool[0].slice(0, 2).toUpperCase()
  return "?"
}

/** Authed account flyout (Stage A port): REAL location switching (each entry = an org's
 *  primary location; switching calls switchOrganizationAction), Settings, sign out.
 *  Leads with the BUSINESS (location/org name) — the avatar is the business mark, the
 *  person + role sit below (ALT-161). `locked` (account on hold): keep org-switching +
 *  sign out (so the user can jump to an active org or leave), but hide "Add a location"
 *  and "Settings" — both route into gated pages that just bounce back to the held panel.
 *  Billing lives on the held panel itself. */
export default function AccountMenu({
  userName,
  locations,
  currentRole = null,
  isPlatformAdmin = false,
  locked = false,
}: {
  userName: string
  locations: AccountLocation[]
  currentRole?: string | null
  isPlatformAdmin?: boolean
  locked?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  // The org we're switching TO while the transition resolves — drives the inline spinner
  // so a click shows immediate feedback (ALT-162b: users were clicking repeatedly).
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const current = locations.find((l) => l.current) ?? locations[0]

  // Toggle the flyout, clearing the filter on every close so it reopens on the full list.
  function setOpenState(next: boolean) {
    setOpen(next)
    if (!next) setQuery("")
  }

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpenState(false) }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpenState(false) }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onEsc)
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc) }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return locations
    return locations.filter(
      (l) => l.name.toLowerCase().includes(q) || (l.city?.toLowerCase().includes(q) ?? false)
    )
  }, [locations, query])

  function switchTo(l: AccountLocation) {
    if (l.current) { setOpenState(false); return }
    // Close immediately + flag the spinner so the click reads as "doing something".
    setOpenState(false)
    setSwitchingTo(l.organizationId)
    startTransition(async () => {
      await switchOrganizationAction(l.organizationId)
      router.push("/home")
      router.refresh()
    })
  }

  // Show the filter only when there are enough locations to warrant it.
  const showFilter = locations.length > 6

  return (
    <div className="pv-acct" ref={ref}>
      {open ? (
        <div className="pv-acct__flyout" role="menu">
          <div className="pv-acct__sec">{locations.length > 1 ? "Switch location" : "Your location"}</div>
          {isPlatformAdmin && (
            <Link
              href="/admin"
              className="pv-acct__admin"
              role="menuitem"
              onClick={() => setOpenState(false)}
            >
              <span className="pv-acct__admin-ico" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 1.5 2.5 4v3.5c0 3.2 2.3 5.6 5.5 7 3.2-1.4 5.5-3.8 5.5-7V4L8 1.5Z" />
                  <path d="M5.8 8 7.4 9.6 10.4 6.4" />
                </svg>
              </span>
              <span>Admin panel</span>
            </Link>
          )}
          {showFilter && (
            <input
              type="text"
              className="pv-acct__filter"
              placeholder="Filter locations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter locations"
              autoFocus
            />
          )}
          <div className="pv-acct__loclist">
            {filtered.length === 0 ? (
              <div className="pv-acct__empty">No matches</div>
            ) : (
              filtered.map((l) => {
                const isSwitching = switchingTo === l.organizationId
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`pv-acct__loc${l.current ? " is-current" : ""}`}
                    role="menuitemradio"
                    aria-checked={l.current}
                    disabled={pending}
                    onClick={() => switchTo(l)}
                  >
                    <span className="pv-acct__mark">{initials(l.name)}</span>
                    <span className="pv-acct__loc-name">{l.name}{l.city ? <span>{l.city}</span> : null}</span>
                    {isSwitching ? (
                      <span className="pv-acct__spin" aria-label="Switching" />
                    ) : l.current ? (
                      <span className="pv-acct__current-tag" aria-hidden>Current</span>
                    ) : l.building ? (
                      <span className="pv-acct__building-tag" aria-label="Still building">Building</span>
                    ) : null}
                  </button>
                )
              })
            )}
          </div>
          <div className="pv-acct__divider" />
          {!locked && (
            <>
              <Link href="/locations/new" className="pv-acct__item" role="menuitem" onClick={() => setOpenState(false)}>Add a location</Link>
              <Link href="/settings" className="pv-acct__item" role="menuitem" onClick={() => setOpenState(false)}>Settings</Link>
            </>
          )}
          <form action={signOutAction}>
            <button type="submit" className="pv-acct__item" role="menuitem">Sign out</button>
          </form>
        </div>
      ) : null}
      <button type="button" className="pv-acct__btn" onClick={() => setOpenState(!open)} aria-expanded={open} aria-haspopup="menu">
        {/* Avatar represents the BUSINESS (its mark), not the person (ALT-161). */}
        <span className="pv-mono">{current ? initials(current.name) : "?"}</span>
        <span className="pv-who">
          <b>{current?.name ?? "No location"}</b>
          <span>{[userName, currentRole].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="pv-acct__chev" aria-hidden>⌄</span>
      </button>
    </div>
  )
}
