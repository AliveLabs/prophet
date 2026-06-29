"use client"

import { LpReveal, stIdx } from "./landing-shared"

/* ── small animated viz (reduced-motion safe via lp-* reveal classes) ── */
function RadarViz() {
  return (
    <svg viewBox="0 0 200 150" className="lp-feature-viz" role="img" aria-label="Competitor radar with pinging signals.">
      <circle cx="100" cy="75" r="58" fill="none" stroke="var(--line-2)" strokeWidth="1" opacity="0.7" />
      <circle cx="100" cy="75" r="38" fill="none" stroke="var(--line-2)" strokeWidth="1" opacity="0.5" />
      <circle cx="100" cy="75" r="18" fill="none" stroke="var(--line-2)" strokeWidth="1" opacity="0.4" />
      <circle cx="100" cy="75" r="4" fill="var(--slate)" />
      {[
        { cx: 64, cy: 42, c: "var(--gold)" },
        { cx: 140, cy: 56, c: "var(--teal)" },
        { cx: 70, cy: 108, c: "var(--rust)" },
        { cx: 146, cy: 104, c: "var(--slate)" },
      ].map((p, i) => (
        <circle key={i} className="lp-pulse-dot" cx={p.cx} cy={p.cy} r="4.5" fill={p.c} style={{ animationDelay: `${i * 0.4}s` }} />
      ))}
    </svg>
  )
}

function TrendViz() {
  return (
    <svg viewBox="0 0 200 100" className="lp-feature-viz" role="img" aria-label="Local search visibility trending up.">
      {[28, 56, 84].map((y) => (
        <line key={y} x1="8" y1={y} x2="192" y2={y} stroke="var(--line-2)" strokeWidth="1" opacity="0.6" />
      ))}
      <path className="lp-fade" d="M10 84 L48 70 L86 74 L124 54 L162 42 L190 24 L190 92 L10 92 Z" fill="var(--teal)" opacity="0.1" />
      <path className="lp-line" d="M10 84 L48 70 L86 74 L124 54 L162 42 L190 24" fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="lp-fade" cx="190" cy="24" r="3.5" fill="var(--teal)" />
    </svg>
  )
}

function MenuBarsViz() {
  const bars = [
    { label: "Entrées", you: 78, them: 60 },
    { label: "Apps", you: 52, them: 68 },
    { label: "Drinks", you: 60, them: 38 },
  ]
  return (
    <svg viewBox="0 0 200 120" className="lp-feature-viz" role="img" aria-label="Menu category comparison, you versus competitor average.">
      {bars.map((b, i) => {
        const y = 12 + i * 34
        return (
          <g key={i}>
            <text x="2" y={y + 9} fontFamily="var(--font-cond)" fontSize="9" fill="var(--ink-3)">{b.label}</text>
            <rect className="lp-bar" x="56" y={y} width={b.you} height="10" rx="4" fill="var(--teal)" opacity="0.85" style={{ transitionDelay: `${i * 0.1}s` }} />
            <rect className="lp-bar" x="56" y={y + 14} width={b.them} height="10" rx="4" fill="var(--gold)" opacity="0.7" style={{ transitionDelay: `${i * 0.1 + 0.1}s` }} />
          </g>
        )
      })}
    </svg>
  )
}

function SocialRingsViz() {
  const rings = [
    { cx: 38, label: "IG", pct: 0.72, c: "var(--gold)" },
    { cx: 100, label: "FB", pct: 0.46, c: "var(--teal)" },
    { cx: 162, label: "TT", pct: 0.86, c: "var(--rust)" },
  ]
  const r = 22
  const C = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 200 84" className="lp-feature-viz" role="img" aria-label="Engagement rings across Instagram, Facebook and TikTok.">
      {rings.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy="36" r={r} fill="none" stroke="var(--paper-2)" strokeWidth="4" />
          <circle
            className="lp-fade"
            cx={p.cx} cy="36" r={r} fill="none" stroke={p.c} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - p.pct)} transform={`rotate(-90 ${p.cx} 36)`}
            style={{ transitionDelay: `${i * 0.15}s` }}
          />
          <text x={p.cx} y="40" textAnchor="middle" fontFamily="var(--font-display)" fontSize="11" fontWeight="700" fill="var(--ink)">{p.label}</text>
          <text x={p.cx} y="76" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-3)">{Math.round(p.pct * 100)}%</text>
        </g>
      ))}
    </svg>
  )
}

function PhotoScanViz() {
  return (
    <svg viewBox="0 0 200 120" className="lp-feature-viz" role="img" aria-label="A photo grid being analyzed by AI.">
      <defs>
        <clipPath id="lp-photo-clip"><rect x="8" y="8" width="184" height="84" rx="8" /></clipPath>
      </defs>
      <g clipPath="url(#lp-photo-clip)">
        {[
          { x: 8, c: "var(--slate-tint)" },
          { x: 100, c: "var(--rust-tint)" },
        ].map((cell, i) => (
          <rect key={i} x={cell.x} y="8" width="92" height="84" fill={cell.c} />
        ))}
        <rect x="8" y="50" width="184" height="42" fill="var(--teal-tint)" opacity="0.5" />
        <rect className="lp-scan" x="8" y="8" width="184" height="3" rx="1.5" fill="var(--rust)" opacity="0.5" />
      </g>
      <rect x="8" y="8" width="184" height="84" rx="8" fill="none" stroke="var(--line-2)" />
      <rect x="64" y="100" width="72" height="16" rx="8" fill="var(--rust-tint)" />
      <text x="100" y="111" textAnchor="middle" fontFamily="var(--font-cond)" fontSize="9" fontWeight="700" fill="var(--rust-deep)">AI ANALYZED</text>
    </svg>
  )
}

function HeatmapViz() {
  const rows = [
    [0.2, 0.5, 0.3, 0.7, 0.9],
    [0.3, 0.7, 0.5, 0.9, 0.8],
    [0.5, 0.8, 0.7, 1.0, 0.9],
    [0.4, 0.7, 0.6, 0.5, 0.3],
  ]
  return (
    <svg viewBox="0 0 200 110" className="lp-feature-viz" role="img" aria-label="Foot-traffic heatmap across the week.">
      {rows.map((row, i) =>
        row.map((v, j) => (
          <rect
            key={`${i}-${j}`} className="lp-fade"
            x={16 + j * 36} y={8 + i * 24} width="30" height="18" rx="4"
            fill="var(--slate)" opacity={v * 0.75}
            style={{ transitionDelay: `${(i * 5 + j) * 0.03}s` }}
          />
        ))
      )}
    </svg>
  )
}

export function PassFeatures() {
  return (
    <section id="features" className="lp-section">
      <div className="lp-wrap">
        <LpReveal className="lp-section-head" as="div">
          <span className="lp-eyebrow">What we watch</span>
          <h2 className="lp-h2">
            Six intelligence channels.{" "}
            <span className="lp-flourish">One feed.</span>
          </h2>
          <p className="lp-sub">Every shift scored and surfaced. None of the noise.</p>
        </LpReveal>

        <LpReveal className="lp-bento" as="div" stagger>
          {/* Competitor monitoring — wide */}
          <div className="lp-feature lp-feature-wide lp-col-8" style={stIdx(0)}>
            <div className="lp-feature-text">
              <span className="lp-feature-icon lp-ic-competitive" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <h3>Competitor monitoring</h3>
              <p>
                Track up to 50 competitors across Google, social, and their own sites.
                Daily snapshots catch changes the moment they happen — reviews, ratings,
                hours, attributes, and more.
              </p>
              <div className="lp-tagrow">
                {["Reviews", "Ratings", "Menus", "Social", "Search"].map((t) => (
                  <span key={t} className="lp-tag">{t}</span>
                ))}
              </div>
            </div>
            <RadarViz />
          </div>

          {/* Search visibility — narrow */}
          <div className="lp-feature lp-feature-sm lp-col-4" style={stIdx(1)}>
            <span className="lp-feature-icon lp-ic-menu" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </span>
            <h3>Search visibility</h3>
            <p>Local search dominance, keyword rankings, competitor overlap, and ad creatives.</p>
            <TrendViz />
          </div>

          {/* Menu intelligence — narrow */}
          <div className="lp-feature lp-feature-sm lp-col-4" style={stIdx(2)}>
            <span className="lp-feature-icon lp-ic-menu" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
              </svg>
            </span>
            <h3>Menu intelligence</h3>
            <p>Know when competitors change prices, add items, or launch promotions — side by side.</p>
            <MenuBarsViz />
          </div>

          {/* Social intelligence — wide */}
          <div className="lp-feature lp-feature-wide lp-col-8" style={stIdx(3)}>
            <div className="lp-feature-text">
              <span className="lp-feature-icon lp-ic-social" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7.5 8.5a4.5 4.5 0 1 0 0 7M16.5 8.5a4.5 4.5 0 1 1 0 7M12 6v12" />
                </svg>
              </span>
              <h3>Social intelligence</h3>
              <p>
                Beyond mentions. Track sentiment velocity across Instagram, Facebook,
                and TikTok to spot a viral moment — or a brewing problem — before it peaks.
              </p>
              <div className="lp-tagrow">
                {["Instagram", "Facebook", "TikTok", "Engagement", "Sentiment"].map((t) => (
                  <span key={t} className="lp-tag">{t}</span>
                ))}
              </div>
            </div>
            <SocialRingsViz />
          </div>

          {/* Visual intelligence — half */}
          <div className="lp-feature lp-feature-sm lp-col-6" style={stIdx(4)}>
            <span className="lp-feature-icon lp-ic-reputation" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
              </svg>
            </span>
            <h3>Visual intelligence</h3>
            <p>AI photo analysis — quality scoring, ambiance detection, food presentation grading, and brand consistency audits.</p>
            <PhotoScanViz />
          </div>

          {/* Foot traffic & events — half */}
          <div className="lp-feature lp-feature-sm lp-col-6" style={stIdx(5)}>
            <span className="lp-feature-icon lp-ic-competitive" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.1a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <h3>Foot traffic &amp; events</h3>
            <p>Popular-times data, local event discovery, and competitor match analysis — plan staffing and promotions around real demand.</p>
            <HeatmapViz />
          </div>
        </LpReveal>
      </div>
    </section>
  )
}
