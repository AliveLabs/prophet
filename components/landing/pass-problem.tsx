"use client"

import { LpReveal } from "./landing-shared"

const NOISE = [62, 80, 44, 88, 54, 70, 38, 60]

/** Raw market data (muted) → one signal pulled out (gold). Pure presentation. */
function NoiseToSignal() {
  return (
    <LpReveal className="lp-panel" threshold={0.3}>
      <div className="lp-panel-bar">
        <span className="lp-panel-dots" aria-hidden="true">
          <i /><i /><i />
        </span>
        <span className="lp-panel-title">raw market data → signal</span>
      </div>
      <div className="lp-panel-body">
        <svg
          viewBox="0 0 360 268"
          className="lp-panel-svg"
          role="img"
          aria-label="Many faint rows of raw market data with a single highlighted signal row."
        >
          <text x="4" y="14" fontFamily="var(--font-mono)" fontSize="9" fill="var(--ink-3)" letterSpacing="0.6">
            RAW MARKET DATA
          </text>
          {NOISE.map((w, i) => {
            const isSignal = i === 3
            const y = 28 + i * 28
            return (
              <g key={i}>
                <rect
                  className="lp-bar"
                  x="4" y={y} width={`${w}%`} height="16" rx="5"
                  fill={isSignal ? "var(--gold)" : "var(--ink-2)"}
                  opacity={isSignal ? 0.9 : 0.14}
                  style={{ transitionDelay: `${i * 0.06}s` }}
                />
                {isSignal && (
                  <text
                    className="lp-fade"
                    x="12" y={y + 12} fontFamily="var(--font-mono)" fontSize="9" fontWeight="700"
                    fill="#3a2a08" letterSpacing="0.6" style={{ transitionDelay: "0.6s" }}
                  >
                    SIGNAL DETECTED
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </LpReveal>
  )
}

export function PassProblem() {
  return (
    <section id="problem" className="lp-section">
      <div className="lp-wrap">
        <div className="lp-split">
          <LpReveal className="lp-split-copy" as="div">
            <span className="lp-rule" aria-hidden="true" />
            <h2 className="lp-h2">
              Your competitors moved Tuesday.
              <br />
              <span className="lp-flourish lp-em">You found out Friday.</span>
            </h2>
            <p className="lp-sub">
              A competitor drops prices across three locations. By the time customers
              mention it, you&rsquo;ve already lost a week of margin. Your POS tracks what
              sold — Ticket tracks what&rsquo;s shifting around you.
            </p>
            <p className="lp-sub">
              Every signal is scored by confidence. High means multiple sources confirmed;
              Medium means an emerging pattern. You decide what&rsquo;s worth acting on.
            </p>
          </LpReveal>

          <NoiseToSignal />
        </div>
      </div>
    </section>
  )
}
