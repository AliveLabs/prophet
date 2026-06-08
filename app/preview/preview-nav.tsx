"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

// Value-driven, answer-first nav. The ~11 production modules collapse to three
// destinations; every signal source (events/weather/social/traffic/visibility/
// photos/menu) becomes a drill-down/evidence, not a nav item. Settings + location
// switching move into the account flyout; Locations becomes the switcher.
const ITEMS = [
  { href: "/preview/today", label: "Today" },
  { href: "/preview/competitors", label: "Competitors" },
  { href: "/preview/ask", label: "Ask" },
]

export default function PreviewNav() {
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
