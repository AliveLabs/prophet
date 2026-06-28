import type { ReactNode } from "react"

// Shared nav source for the desktop sidebar (ShellNav) and the mobile bottom tab bar
// (MobileTabBar) so the two never drift. Mirrors the value-driven nav (see shell-nav.tsx):
// the legacy 11-module nav is gone; every other signal source is drill-down / evidence.
export interface NavItem {
  href: string
  label: string
  icon: ReactNode
}

const sw = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/home",
    label: "Today",
    icon: (
      <svg viewBox="0 0 20 20" {...sw}>
        <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
        <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
        <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
        <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/competitors",
    label: "Competitors",
    icon: (
      <svg viewBox="0 0 20 20" {...sw}>
        <circle cx="6.8" cy="7" r="3" />
        <circle cx="13.6" cy="7.4" r="2.4" />
        <path d="M2 17 c0-3 2.2-4.6 4.8-4.6 S11.6 14 11.6 17" />
        <path d="M12.8 12.6 c2.2 .1 4 1.4 4.2 4" />
      </svg>
    ),
  },
  {
    href: "/ask",
    label: "Ask",
    icon: (
      <svg viewBox="0 0 20 20" {...sw}>
        <path d="M3 5.5 A2.5 2.5 0 0 1 5.5 3 h9 A2.5 2.5 0 0 1 17 5.5 v6 A2.5 2.5 0 0 1 14.5 14 H8 l-4 3 v-3 H5.5" />
        <path d="M7.7 7.4 a2.3 2.3 0 1 1 3 2.2 c-.8 .3-1 .7-1 1.4" />
        <circle cx="9.7" cy="12.3" r=".5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: "/weather",
    label: "Weather",
    icon: (
      <svg viewBox="0 0 20 20" {...sw}>
        <circle cx="10" cy="10" r="3.2" />
        <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.4 4.4l1.4 1.4M14.2 14.2l1.4 1.4M15.6 4.4l-1.4 1.4M5.8 14.2l-1.4 1.4" />
      </svg>
    ),
  },
  {
    href: "/events",
    label: "Events",
    icon: (
      <svg viewBox="0 0 20 20" {...sw}>
        <rect x="2.5" y="3.5" width="15" height="14" rx="2" />
        <path d="M6 1.8v3.4M14 1.8v3.4M2.5 8h15" />
      </svg>
    ),
  },
]
