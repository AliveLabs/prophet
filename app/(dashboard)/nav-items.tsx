import type { ReactNode } from "react"
import { TicketChatMark } from "@/components/brand/ticket-chat-mark"

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
    // ALT-353: the Review Intelligence triage surface. Sits right after
    // Competitors — reviews are the operator's own-reputation counterpart to
    // the competitive read, ahead of the outside-influence trio below.
    href: "/reviews",
    label: "Reviews",
    // Speech-bubble + star hybrid: a customer's words with the rating inside
    // (same 1.5 stroke language as the rest of the rail).
    icon: (
      <svg viewBox="0 0 20 20" {...sw}>
        <path d="M17 8.8c0 2.9-3.1 5.2-7 5.2-.7 0-1.4-.1-2-.2l-3.5 2.4.7-2.6C3.8 12.6 3 10.8 3 8.8c0-2.9 3.1-5.2 7-5.2s7 2.3 7 5.2z" />
        <path d="M10 6.2l.8 1.6 1.8.3-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.3z" />
      </svg>
    ),
  },
  {
    href: "/ask",
    label: "Ask",
    // The Ticket chat mark — the same T-bubble that triggers "Ask Ticket about
    // this" on viz cards (ALT-230) and the scorecard's gap ingress, so ONE
    // recognizable mark carries the ask behavior everywhere it exists.
    icon: <TicketChatMark size={20} shape="square" />,
  },
  {
    // ALT-160: the Social page was built but never wired into the nav. It joins
    // Weather + Events as the third "outside-influence" category (your own + your
    // competitors' social presence), so it leads that trio here.
    href: "/social",
    label: "Social",
    // Share/network glyph: three connected nodes (mirrors the social empty-state icon).
    icon: (
      <svg viewBox="0 0 20 20" {...sw}>
        <circle cx="5" cy="10" r="2.2" />
        <circle cx="14.5" cy="4.8" r="2.2" />
        <circle cx="14.5" cy="15.2" r="2.2" />
        <path d="M6.9 8.9l5.7-3.1M6.9 11.1l5.7 3.1" />
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
