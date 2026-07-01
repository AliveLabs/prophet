// Shared hero-photo tier for any TkHero `photo` slot.
//
// Renders a REAL image into the kit's `.tk-photo` surface (background-size:cover +
// a `.tk-veil` scrim for badge legibility) when we have one, else falls back to the
// surface's own gradient canvas. This is the single place the brief, play-detail,
// traffic, and locations heroes swap their "default" canvas for a real photo — the
// swap the per-surface canvases always said was coming ("swap this for an <img> later").
//
// Server-safe presentational component (a plain div): importable from server pages and
// client islands (locations-board) alike. Mirrors the established competitor-detail hero
// (competitors/[id]/page.tsx), which already does exactly this cascade.

import type { CSSProperties, ReactNode } from "react"

export function HeroImage({
  url,
  label,
  fallback,
}: {
  /** already-resolved public photo URL (own-listing cover / competitor cover / post image) */
  url?: string | null
  /** honest label shown as the photo chip + aria-label (location or competitor name) */
  label?: string
  /** the surface's gradient canvas, rendered when there's no real photo */
  fallback: ReactNode
}) {
  if (!url) return <>{fallback}</>
  return (
    <div
      className="tk-photo"
      style={{ backgroundImage: `url(${url})` } as CSSProperties}
      data-label={label}
      role="img"
      aria-label={label ? `${label} — Google Business photo` : "Listing photo"}
    >
      <div className="tk-veil" />
    </div>
  )
}
