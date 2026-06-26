"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

// The value-driven nav (Stage A port of the preview nav onto authed routes).
// The ~11 legacy modules are out of the nav; every signal source becomes drill-down /
// evidence. Settings + location switching live in the account flyout. Weather + Events
// are CONDITIONAL — shown only for restaurants where they actually matter (a patio /
// walk-in spot for weather; a non-rural / event-dense spot for events). The layout
// derives the gates and passes them in.
type NavItem = { href: string; label: string }
const BASE_ITEMS: NavItem[] = [
  { href: "/home", label: "Today" },
  { href: "/competitors", label: "Competitors" },
  { href: "/ask", label: "Ask" },
]

function buildItems(showWeather: boolean, showEvents: boolean): NavItem[] {
  // Insert Weather/Events right after "Today" so the day's contextual views sit together.
  const contextual: NavItem[] = []
  if (showWeather) contextual.push({ href: "/weather", label: "Weather" })
  if (showEvents) contextual.push({ href: "/events", label: "Events" })
  return [BASE_ITEMS[0], ...contextual, ...BASE_ITEMS.slice(1)]
}

// `locked` (account on hold): render the items as inert, muted labels — the
// nav stays visible so the shell reads as "my account," but every route is
// gated to the held-state panel, so live links would just bounce in place.
export default function ShellNav({
  locked = false,
  showWeather = false,
  showEvents = false,
}: {
  locked?: boolean
  showWeather?: boolean
  showEvents?: boolean
}) {
  const pathname = usePathname()
  const items = buildItems(showWeather, showEvents)
  return (
    <nav className="pv-nav">
      {items.map((it) => {
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
