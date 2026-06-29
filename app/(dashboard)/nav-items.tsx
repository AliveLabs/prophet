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
    // A day-on-the-calendar: a single calendar page with the current day marked.
    // (Events uses a multi-day calendar; Today is one highlighted day — reads as "today".)
    icon: (
      <svg viewBox="0 0 20 20" {...sw}>
        <rect x="3" y="4" width="14" height="13" rx="2" />
        <path d="M3 8h14M6.5 2.5v3M13.5 2.5v3" />
        <rect x="6.4" y="10.4" width="3.4" height="3.4" rx="0.8" fill="currentColor" stroke="none" />
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
    // Speech bubble + question mark, centered within the viewBox with even padding so
    // the left edge isn't clipped (the old path hugged x=3 and read as cut off).
    icon: (
      <svg viewBox="0 0 20 20" {...sw}>
        <path d="M3.5 6 A2.5 2.5 0 0 1 6 3.5 h8 A2.5 2.5 0 0 1 16.5 6 v5.5 A2.5 2.5 0 0 1 14 14 H8.5 l-3.5 2.8 V14 H6 A2.5 2.5 0 0 1 3.5 11.5 Z" />
        <path d="M8.4 7.6 a1.8 1.8 0 1 1 2.4 1.7 c-.6 .25-.8 .55-.8 1.1" />
        <circle cx="10" cy="11.9" r=".55" fill="currentColor" stroke="none" />
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
