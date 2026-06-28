"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { NAV_ITEMS } from "./nav-items"

// Native-feel bottom tab bar (shown < 900px via .pv-tabbar in operator.css). Shares the
// exact nav source with the desktop sidebar. Settings / location-switch / sign-out are
// reachable from the mobile top app-bar account flyout (see layout.tsx), so every task
// stays completable on mobile without a desktop.
export default function MobileTabBar() {
  const pathname = usePathname()
  return (
    <nav className="pv-tabbar" aria-label="Primary">
      {NAV_ITEMS.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + "/")
        return (
          <Link key={it.href} href={it.href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined}>
            <span className="pv-nav-ico" aria-hidden>{it.icon}</span>
            {it.label}
          </Link>
        )
      })}
    </nav>
  )
}
