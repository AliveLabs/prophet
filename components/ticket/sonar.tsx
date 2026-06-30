// ALT-241 — the competitor "sonar" motif: a radar scope whose sweep reveals
// competitor blips. One motif, used wherever we depict watching the market — the
// login status block here, and the same scope (statically, inlined) as the
// Competitors nav icon. Server-safe: pure SVG + CSS animation (no hooks), so it
// drops into server or client trees alike. Token-driven (teal scan, rust "you",
// gold competitor blips, neutral rings) so it adapts light/dark; all motion sits
// behind prefers-reduced-motion (see .tk-sonar-* in pass.css).

import { tkcx as cx } from "./primitives"

export function TkSonar({
  size = 120,
  label = "Watching your competitors",
  className,
}: {
  /** rendered px (the SVG scales to fill) */
  size?: number
  /** accessible label — the scope itself is decorative */
  label?: string
  className?: string
}) {
  return (
    <span
      className={cx("tk-sonar", className)}
      role="img"
      aria-label={label}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        {/* static scope rings */}
        <circle className="tk-sonar-ring" cx="60" cy="60" r="52" />
        <circle className="tk-sonar-ring" cx="60" cy="60" r="32" />
        {/* expanding pings (the radiating pulse) */}
        <circle className="tk-sonar-ping" cx="60" cy="60" r="8" />
        <circle className="tk-sonar-ping tk-sonar-ping-b" cx="60" cy="60" r="8" />
        {/* rotating sweep: a faint teal wedge led by a bold teal hand */}
        <g className="tk-sonar-sweep">
          <path className="tk-sonar-wedge" d="M60 60 L60 8 A52 52 0 0 1 96 24 Z" />
          <line className="tk-sonar-hand" x1="60" y1="60" x2="60" y2="8" />
        </g>
        {/* competitor blips — twinkle as the sweep passes */}
        <circle className="tk-sonar-blip" cx="86" cy="40" r="3.2" />
        <circle className="tk-sonar-blip tk-sonar-blip-b" cx="34" cy="78" r="3.2" />
        <circle className="tk-sonar-blip tk-sonar-blip-c" cx="76" cy="86" r="3.2" />
        {/* you — at the center */}
        <circle className="tk-sonar-core-ring" cx="60" cy="60" r="6" />
        <circle className="tk-sonar-core" cx="60" cy="60" r="3" />
      </svg>
    </span>
  )
}
