"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

// The value-driven 4-item nav (Stage A port of the preview nav onto authed routes).
// The ~11 legacy modules are out of the nav; every signal source becomes drill-down /
// evidence. Settings + location switching live in the account flyout.
const ITEMS = [
  { href: "/home", label: "Today" },
  { href: "/competitors", label: "Competitors" },
  { href: "/ask", label: "Ask" },
]

// `locked` (account on hold): render the items as inert, muted labels — the
// nav stays visible so the shell reads as "my account," but every route is
// gated to the held-state panel, so live links would just bounce in place.
export default function ShellNav({ locked = false }: { locked?: boolean }) {
  const pathname = usePathname()
  return (
    <nav className="pv-nav">
      {ITEMS.map((it) => {
        if (locked) {
          return (
            <span key={it.href} className="is-locked" aria-disabled="true">
              <span className="tick" />
              {it.label}
            </span>
          )
        }
        const active = pathname === it.href || pathname.startsWith(it.href + "/")
        return (
          <Link key={it.href} href={it.href} className={active ? "is-active" : undefined}>
            <span className="tick" />
            {it.label}
          </Link>
        )
      })}
    </nav>
  )
}
