// The Pass — Traffic hero gradient canvas (server-safe, presentational).
//
// A painterly "daily rhythm" field over the kit's .tk-photo surface: a soft
// busy-curve silhouette that reads as foot-traffic over the day, scaling to any
// location (nothing location-specific faked). When a real storefront photo lands
// later, swap this for an <img>.

export function TrafficHeroCanvas({ label }: { label?: string }) {
  return (
    <div className="tk-photo" data-label={label} aria-hidden="true">
      <svg
        className="tk-stadium"
        viewBox="0 0 400 380"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="trf-glow" cx="24%" cy="6%" r="95%">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.5" />
            <stop offset="45%" stopColor="var(--rust)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="trf-curve" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,.22)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="400" height="380" fill="url(#trf-glow)" />
        {/* two busy-curves: a morning bump + a bigger dinner peak — ambient */}
        <path
          d="M-10 320 C60 310 80 250 130 240 C175 232 185 300 220 300 C265 300 270 150 330 140 C375 132 400 200 410 210 L410 380 L-10 380 Z"
          fill="url(#trf-curve)"
        />
        <path
          d="M-10 320 C60 310 80 250 130 240 C175 232 185 300 220 300 C265 300 270 150 330 140 C375 132 400 200 410 210"
          fill="none"
          stroke="rgba(255,255,255,.34)"
          strokeWidth="2.5"
        />
        {/* hour ticks along the base */}
        <g stroke="rgba(255,255,255,.16)" strokeWidth="1.5">
          {[40, 100, 160, 220, 280, 340].map((x) => (
            <line key={x} x1={x} y1="350" x2={x} y2="362" />
          ))}
        </g>
        {/* peak marker dot */}
        <circle cx="330" cy="140" r="4.5" fill="rgba(255,255,255,.9)" />
        <circle cx="330" cy="140" r="9" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5" />
      </svg>
      <div className="tk-veil" />
    </div>
  )
}
