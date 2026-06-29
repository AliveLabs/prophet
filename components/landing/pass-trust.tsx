"use client"

import { MARKETING_STATS } from "@/lib/marketing/stats"
import { LpCount, LpReveal, stIdx } from "./landing-shared"

const METRICS = [
  MARKETING_STATS.signalsDaily,
  MARKETING_STATS.insightTypes,
  MARKETING_STATS.intelChannels,
  MARKETING_STATS.freeTrialDays,
] as const

export function PassTrust() {
  return (
    <section id="trust" className="lp-section">
      <div className="lp-wrap">
        <LpReveal className="lp-section-head" as="div">
          <span className="lp-eyebrow">Not just what changed</span>
          <h2 className="lp-h2">
            <span className="lp-flourish lp-em">What to do about it.</span>
          </h2>
          <p className="lp-sub">
            Ticket was built alongside operators who told us the same thing: “I don’t
            have time for another dashboard.” Every insight ships with a recommended next
            move — specific enough to act on Monday, scored so you know what’s urgent and
            what can wait.
          </p>
        </LpReveal>

        <LpReveal className="lp-stats-grid" as="div" stagger>
          {METRICS.map((m, i) => (
            <div key={m.label} className="lp-stat-card" style={stIdx(i)}>
              <div className="lp-big">
                <LpCount to={m.value} prefix={m.prefix ?? ""} suffix={m.suffix} />
              </div>
              <div className="lp-cap">{m.label}</div>
            </div>
          ))}
        </LpReveal>

        <p className="lp-powered">
          Powered by Google AI, Google Places, and real-time search and market data from
          8+ intelligence sources.
        </p>
      </div>
    </section>
  )
}
