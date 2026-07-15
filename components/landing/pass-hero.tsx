"use client"

import { motion } from "framer-motion"
import { MARKETING_STATS } from "@/lib/marketing/stats"
import { LpCount, LpReveal } from "./landing-shared"

const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 0.61, 0.36, 1] as const } },
}
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.1 } } }

const HERO_STATS = [
  MARKETING_STATS.signalsDaily,
  MARKETING_STATS.insightTypes,
  MARKETING_STATS.intelChannels,
] as const

/** A Pass-styled "daily brief" preview — the product, abstracted (no faked $/POS). */
function BriefPreview() {
  return (
    // Stage wraps the panel + its floating cards. The panel itself keeps
    // `overflow: hidden` (for clean rounded corners), so the cards — which are
    // meant to overhang the panel edges — must live OUTSIDE it, or they get
    // clipped. The stage is the positioning context for the absolute cards.
    <div className="lp-art-stage">
      <LpReveal className="lp-panel" threshold={0.25}>
        <div className="lp-panel-bar">
        <span className="lp-panel-dots" aria-hidden="true">
          <i /><i /><i />
        </span>
        <span className="lp-panel-title">today&rsquo;s brief · ticket</span>
      </div>
      <div className="lp-panel-body">
        <svg
          viewBox="0 0 360 250"
          className="lp-panel-svg"
          role="img"
          aria-label="A daily brief: a confidence-scored signal with a trend line and a head-to-head bar."
        >
          {/* lead play card */}
          <rect x="0" y="0" width="360" height="84" rx="14" fill="var(--card-2)" stroke="var(--line)" />
          <rect x="16" y="16" width="34" height="34" rx="10" fill="var(--rust-tint)" />
          <circle cx="33" cy="33" r="7" fill="none" stroke="var(--rust-deep)" strokeWidth="2" />
          <path d="M33 28v5l3 2" stroke="var(--rust-deep)" strokeWidth="2" strokeLinecap="round" fill="none" />
          <rect x="62" y="18" width="180" height="9" rx="4.5" fill="var(--ink)" opacity="0.78" />
          <rect x="62" y="34" width="250" height="6" rx="3" fill="var(--ink-2)" opacity="0.4" />
          <rect x="62" y="46" width="210" height="6" rx="3" fill="var(--ink-2)" opacity="0.4" />
          {/* confidence pips: high = 3 teal */}
          <g transform="translate(62,62)">
            <rect x="0" y="0" width="16" height="7" rx="3.5" fill="var(--teal)" />
            <rect x="20" y="0" width="16" height="7" rx="3.5" fill="var(--teal)" />
            <rect x="40" y="0" width="16" height="7" rx="3.5" fill="var(--teal)" />
            <text x="64" y="7" fontFamily="var(--font-cond)" fontSize="9" fontWeight="700" fill="var(--teal-deep)" letterSpacing="0.5">HIGH</text>
          </g>

          {/* trend line viz */}
          <rect x="0" y="98" width="216" height="152" rx="14" fill="var(--card-2)" stroke="var(--line)" />
          <text x="16" y="120" fontFamily="var(--font-mono)" fontSize="9" fill="var(--ink-3)" letterSpacing="0.5">SENTIMENT TREND</text>
          {[150, 178, 206].map((y) => (
            <line key={y} x1="16" y1={y} x2="200" y2={y} stroke="var(--line)" strokeWidth="1" opacity="0.6" />
          ))}
          <path
            className="lp-line"
            d="M20 218 L52 200 L86 208 L118 182 L152 168 L186 142"
            fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          />
          <path
            className="lp-fade"
            d="M20 218 L52 200 L86 208 L118 182 L152 168 L186 142 L186 234 L20 234 Z"
            fill="var(--teal)" opacity="0.1"
          />
          <circle className="lp-fade" cx="186" cy="142" r="3.5" fill="var(--teal)" />

          {/* head-to-head bars */}
          <rect x="228" y="98" width="132" height="152" rx="14" fill="var(--card-2)" stroke="var(--line)" />
          <text x="244" y="120" fontFamily="var(--font-mono)" fontSize="9" fill="var(--ink-3)" letterSpacing="0.5">YOU VS COMP</text>
          {[
            { y: 134, you: 80, them: 50, win: true },
            { y: 166, you: 44, them: 70, win: false },
            { y: 198, you: 66, them: 40, win: true },
          ].map((r, i) => (
            <g key={i}>
              <rect x="244" y={r.y} width="100" height="9" rx="4.5" fill="var(--paper-2)" />
              <rect
                className="lp-bar" x="244" y={r.y} width={r.you} height="9" rx="4.5"
                fill={r.win ? "var(--teal)" : "var(--alert)"} style={{ transitionDelay: `${0.2 + i * 0.12}s` }}
              />
              <text x="244" y={r.y + 24} fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-3)">
                {r.win ? "you lead" : "behind"}
              </text>
            </g>
          ))}
        </svg>
      </div>
      </LpReveal>

      {/* floating mini cards over the panel — siblings of the panel (not inside
          its clipped box) so their negative offsets can overhang the edges */}
      <div className="lp-float-card lp-float-tl lp-floaty" aria-hidden="true">
        <div className="lp-float-head">
          <span className="lp-sig-dot" />
          <span className="lp-float-tag">Signal detected</span>
        </div>
        <p>A nearby competitor dropped lunch pricing — flagged 22 days before it showed up in foot-traffic.</p>
        <div className="lp-float-foot">22 days ahead</div>
      </div>
      <div className="lp-float-card lp-float-br lp-floaty-slow" aria-hidden="true">
        <div className="lp-float-head">
          <span className="lp-sig-dot" style={{ background: "var(--teal)" }} />
          <span className="lp-float-tag" style={{ color: "var(--teal-deep)" }}>Recommended move</span>
        </div>
        <p>Match the window, not the price. Push your faster pickup in this week&rsquo;s post.</p>
      </div>
    </div>
  )
}

export function PassHero() {
  return (
    <section id="hero" className="lp-section lp-hero">
      <div className="lp-wrap">
        <div className="lp-hero-grid">
          <motion.div
            className="lp-hero-copy"
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.span className="lp-kicker" variants={fadeUp}>
              <span className="lp-live-dot" aria-hidden="true" />
              Read the ticket
            </motion.span>

            <motion.h1 className="lp-display" variants={fadeUp}>
              Know what&rsquo;s{" "}
              <span className="lp-flourish lp-em">firing</span>
              <br />
              before it hits your P&amp;L.
            </motion.h1>

            <motion.p className="lp-sub" variants={fadeUp} style={{ maxWidth: "34ch" }}>
              Ticket watches competitor menus, pricing, reviews, and social — every
              shift scored by confidence, so you move first, not last.
            </motion.p>

            <motion.div className="lp-hero-cta-row" variants={fadeUp}>
              <a href="#waitlist" className="lp-cta lp-cta-primary">
                Request early access
              </a>
              <a href="#features" className="lp-cta lp-cta-ghost">
                See what Ticket watches
              </a>
            </motion.div>

            <motion.div className="lp-hero-stats" variants={fadeUp}>
              {HERO_STATS.map((s) => (
                <div key={s.shortLabel}>
                  <div className="lp-stat-n">
                    <LpCount to={s.value} prefix={s.prefix ?? ""} suffix={s.suffix} />
                  </div>
                  <div className="lp-stat-l">{s.shortLabel}</div>
                </div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            className="lp-hero-art"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <BriefPreview />
          </motion.div>
        </div>
      </div>
    </section>
  )
}
