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

export default function ShellNav() {
  const pathname = usePathname()
  return (
    <nav className="pv-nav">
      {ITEMS.map((it) => {
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
