// Small inline SVG glyphs used in the settings section heads / empty states.
// Stroke uses currentColor so they inherit the kit's tinted icon tiles.

import type { ReactNode } from "react"

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const

export const ICON_ACCOUNT: ReactNode = (
  <svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
)
export const ICON_BRIEF: ReactNode = (
  <svg viewBox="0 0 24 24" {...S}><path d="M5 4h14v16H5z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>
)
export const ICON_DATA: ReactNode = (
  <svg viewBox="0 0 24 24" {...S}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>
)
export const ICON_SOCIAL: ReactNode = (
  <svg viewBox="0 0 24 24" {...S}><rect x="4" y="4" width="16" height="16" rx="4" /><circle cx="12" cy="12" r="3.5" /><circle cx="16.5" cy="7.5" r="1" fill="currentColor" stroke="none" /></svg>
)
export const ICON_COMPETITORS: ReactNode = (
  <svg viewBox="0 0 24 24" {...S}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M15.5 20c.3-2 1.8-3.4 4.5-3.4" /></svg>
)
export const ICON_COMMS: ReactNode = (
  <svg viewBox="0 0 24 24" {...S}><path d="M4 5h16v12H7l-3 3z" /><path d="M8 9h8M8 12h5" /></svg>
)
export const ICON_BILLING: ReactNode = (
  <svg viewBox="0 0 24 24" {...S}><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M3 10h18" /><path d="M7 15h4" /></svg>
)
export const ICON_ORG: ReactNode = (
  <svg viewBox="0 0 24 24" {...S}><path d="M4 21V7l8-4 8 4v14" /><path d="M9 21v-5h6v5" /><path d="M8 9h2M14 9h2M8 12h2M14 12h2" /></svg>
)
export const ICON_TEAM: ReactNode = (
  <svg viewBox="0 0 24 24" {...S}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M15.5 20c.3-2 1.8-3.4 4.5-3.4" /></svg>
)
export const ICON_CHECK: ReactNode = (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
export const ICON_ARROW: ReactNode = (
  <svg viewBox="0 0 16 16" {...S}><path d="M3 8h9M9 5l3 3-3 3" /></svg>
)
