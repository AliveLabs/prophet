// The Pass — the lead hero's gradient canvas (server-safe, presentational).
// A painterly multi-hue field over the kit's .tk-photo surface + a soft veil,
// scaling to ANY location type (no stadium / location-specific imagery faked).
// When a real storefront photo exists later, swap this for an <img>.

import type { CSSProperties } from "react"
import type { TkFamily } from "@/components/ticket"

const FAMILY_HUE: Record<TkFamily, string> = {
  competitive: "var(--slate)",
  reputation: "var(--rust)",
  social: "var(--gold)",
  menu: "var(--teal)",
  grassroots: "var(--teal)",
}

export function PassHeroCanvas({ family, label }: { family: TkFamily; label?: string }) {
  const hue = FAMILY_HUE[family]
  return (
    <div className="tk-photo pass-hero-canvas" data-label={label} aria-hidden="true">
      <svg
        className="tk-stadium pass-hero-art"
        viewBox="0 0 400 380"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        style={{ "--pass-hue": hue } as CSSProperties}
      >
        <defs>
          <radialGradient id="pass-glow" cx="22%" cy="8%" r="90%">
            <stop offset="0%" stopColor="var(--pass-hue)" stopOpacity="0.55" />
            <stop offset="55%" stopColor="var(--pass-hue)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="400" height="380" fill="url(#pass-glow)" />
        {/* soft contour drift — ambient, not literal */}
        <g fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="2">
          <path d="M-20 250 Q120 170 220 230 T420 200" />
          <path d="M-20 300 Q140 230 240 280 T420 250" />
          <path d="M-20 200 Q100 120 200 180 T420 150" />
        </g>
        <g fill="rgba(255,255,255,.18)">
          <circle cx="120" cy="210" r="2" />
          <circle cx="170" cy="190" r="2" />
          <circle cx="225" cy="205" r="2" />
          <circle cx="285" cy="225" r="2" />
        </g>
      </svg>
      <div className="tk-veil" />
    </div>
  )
}
