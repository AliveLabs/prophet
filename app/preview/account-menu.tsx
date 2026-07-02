"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import type { AccountLocation } from "./preview-data"
import { TkRule } from "@/components/ticket"

function initials(s: string): string {
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}

/** The account footer turned into a flyout: switch location (one login → many),
 *  reach Settings (per current location), and sign out. Rough — actions not wired. */
export default function AccountMenu({ userName, locations }: { userName: string; locations: AccountLocation[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = locations.find((l) => l.current) ?? locations[0]

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onEsc)
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc) }
  }, [])

  return (
    <div className="pv-acct" ref={ref}>
      {open ? (
        <div className="pv-acct__flyout" role="menu">
          <div className="pv-acct__sec">{locations.length > 1 ? "Switch location" : "Your location"}</div>
          {locations.map((l) => (
            <button key={l.id} type="button" className={`pv-acct__loc${l.current ? " is-current" : ""}`} role="menuitemradio" aria-checked={l.current}>
              <span className="pv-acct__mark">{initials(l.name)}</span>
              <span className="pv-acct__loc-name">{l.name}{l.city ? <span>{l.city}</span> : null}</span>
              {l.current ? <span className="pv-acct__check">✓</span> : null}
            </button>
          ))}
          <button type="button" className="pv-acct__add">+ Add a location</button>
          <TkRule variant="quiet" />
          <Link href="/preview/settings" className="pv-acct__item" role="menuitem" onClick={() => setOpen(false)}>Settings</Link>
          <button type="button" className="pv-acct__item" role="menuitem">Sign out</button>
          <div className="pv-acct__soon">Switching, add-location & sign-out aren&apos;t wired yet. Settings apply to the current location.</div>
        </div>
      ) : null}
      <button type="button" className="pv-acct__btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="pv-mono">{initials(userName)}</span>
        <span className="pv-who"><b>{userName}</b><span>{current?.name ?? "No location"}</span></span>
        <span className="pv-acct__chev" aria-hidden>⌄</span>
      </button>
    </div>
  )
}
