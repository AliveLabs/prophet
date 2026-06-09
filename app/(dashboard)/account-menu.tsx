"use client"

import { useState, useRef, useEffect, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signOutAction, switchOrganizationAction } from "./actions"
import type { AccountLocation } from "./operator-data"

function initials(s: string): string {
  return s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}

/** Authed account flyout (Stage A port): REAL location switching (each entry = an org's
 *  primary location; switching calls switchOrganizationAction), Settings, sign out. */
export default function AccountMenu({ userName, locations }: { userName: string; locations: AccountLocation[] }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const current = locations.find((l) => l.current) ?? locations[0]

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onEsc)
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc) }
  }, [])

  function switchTo(l: AccountLocation) {
    if (l.current) { setOpen(false); return }
    startTransition(async () => {
      await switchOrganizationAction(l.organizationId)
      setOpen(false)
      router.push("/home")
      router.refresh()
    })
  }

  return (
    <div className="pv-acct" ref={ref}>
      {open ? (
        <div className="pv-acct__flyout" role="menu">
          <div className="pv-acct__sec">{locations.length > 1 ? "Switch location" : "Your location"}</div>
          {locations.map((l) => (
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
              {l.current ? <span className="pv-acct__check">✓</span> : null}
            </button>
          ))}
          <div className="pv-acct__divider" />
          <Link href="/settings" className="pv-acct__item" role="menuitem" onClick={() => setOpen(false)}>Settings</Link>
          <form action={signOutAction}>
            <button type="submit" className="pv-acct__item" role="menuitem">Sign out</button>
          </form>
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
