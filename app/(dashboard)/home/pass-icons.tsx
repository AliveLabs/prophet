// The Pass — family glyphs (server-safe, presentational only).
// One <svg/> per visual family, matching Concept A's per-family card icons.

import type { ReactNode } from "react"
import type { TkFamily } from "@/components/ticket"

export const FAMILY_ICON: Record<TkFamily, ReactNode> = {
  competitive: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  ),
  reputation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  social: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M10 8l6 4-6 4z" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 2h8l-1 6a3 3 0 0 1-6 0z" />
      <path d="M9 14h6v6a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z" />
    </svg>
  ),
  grassroots: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M22 10L12 5 2 10l10 5 10-5z" />
      <path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" />
    </svg>
  ),
}

// The "ACT" verb + leading glyph per family (lede on the primary button).
export const ACT_ICON: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const KEEP_ICON: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 5v16l7-5 7 5V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z" />
  </svg>
)

export const DISMISS_ICON: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

export const UNDO_ICON: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 7v6h6" />
    <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
  </svg>
)
