"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

// Shared admin nav source — the desktop rail and the mobile bottom-tab dock both
// render from this single list (mirrors the operator shell's NAV_ITEMS pattern).
export interface AdminNavItem {
  href: string
  label: string
  /** shorter label for the mobile tab dock */
  short?: string
  icon: ReactNode
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: <OverviewIcon /> },
  { href: "/admin/waitlist", label: "Waitlist", icon: <WaitlistIcon /> },
  { href: "/admin/users", label: "Users", icon: <UsersIcon /> },
  { href: "/admin/organizations", label: "Organizations", short: "Orgs", icon: <OrgsIcon /> },
  { href: "/admin/knowledge-review", label: "Knowledge", icon: <KnowledgeIcon /> },
  { href: "/admin/source-quality", label: "Source Quality", short: "Sources", icon: <SourceQualityIcon /> },
  { href: "/admin/sandbox", label: "Demo & Test", short: "Demo", icon: <SandboxIcon /> },
  { href: "/admin/maintenance", label: "Maintenance", short: "Maint.", icon: <MaintenanceIcon /> },
  { href: "/admin/settings", label: "Settings", icon: <SettingsIcon /> },
]

// `/admin` is an exact match; the rest match on prefix so child routes light up too.
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin"
  return pathname === href || pathname.startsWith(`${href}/`)
}

/* ── Desktop rail nav ─────────────────────────────────────── */
export function AdminRailNav() {
  const pathname = usePathname() ?? ""
  return (
    <nav className="adm-nav" aria-label="Admin sections">
      {ADMIN_NAV.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <span className="adm-tick" aria-hidden="true" />
            <span className="adm-ico" aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

/* ── Mobile bottom-tab dock ───────────────────────────────── */
export function AdminTabBar() {
  const pathname = usePathname() ?? ""
  return (
    <nav className="adm-tabbar" aria-label="Admin sections">
      {ADMIN_NAV.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            <span className="adm-ico" aria-hidden="true">{item.icon}</span>
            {item.short ?? item.label}
          </Link>
        )
      })}
    </nav>
  )
}

/* ── Icons (stroke glyphs; inherit currentColor) ──────────── */
function OverviewIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1.4" />
      <rect x="9" y="1" width="6" height="6" rx="1.4" />
      <rect x="1" y="9" width="6" height="6" rx="1.4" />
      <rect x="9" y="9" width="6" height="6" rx="1.4" />
    </svg>
  )
}
function WaitlistIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h8" strokeLinecap="round" />
    </svg>
  )
}
function UsersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="5" r="2.5" />
      <path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" strokeLinecap="round" />
    </svg>
  )
}
function OrgsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="3" y="2" width="10" height="12" rx="1" />
      <path d="M6 5h4M6 8h4M6 11h2" strokeLinecap="round" />
    </svg>
  )
}
function KnowledgeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 2h7l3 3v9H3z" strokeLinejoin="round" />
      <path d="M10 2v3h3M5.5 8h5M5.5 11h5" strokeLinecap="round" />
    </svg>
  )
}
function SourceQualityIcon() {
  // a magnifier over a document — "go check the source"
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 2h6l3 3v3" strokeLinejoin="round" />
      <path d="M9 2v3h3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="10.5" r="2.6" />
      <path d="M9 12.5 11 14.5" strokeLinecap="round" />
    </svg>
  )
}
function SandboxIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 13 L8 3 L14 13 Z" strokeLinejoin="round" />
      <path d="M5 13h6" strokeLinecap="round" />
    </svg>
  )
}
function MaintenanceIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M10.5 2.5a3 3 0 0 0-4 4l-4 4a1.5 1.5 0 0 0 2 2l4-4a3 3 0 0 0 4-4l-2 2-2-1-1-2 2-2Z" strokeLinejoin="round" />
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4" />
    </svg>
  )
}
