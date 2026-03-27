"use client"

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

/* ── Competitor Radar SVG ─────────────────────────────────────── */
function CompetitorRadar() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: false })

  const competitors = [
    { cx: 70, cy: 35, color: "var(--signal-gold)", delay: "0s" },
    { cx: 130, cy: 55, color: "var(--precision-teal)", delay: "0.5s" },
    { cx: 50, cy: 90, color: "var(--vatic-indigo-soft)", delay: "1s" },
    { cx: 140, cy: 110, color: "var(--signal-gold)", delay: "1.5s" },
    { cx: 85, cy: 130, color: "var(--precision-teal)", delay: "2s" },
  ]

  return (
    <svg ref={ref} viewBox="0 0 180 160" fill="none" className="w-full h-auto" aria-hidden="true">
      <circle cx="90" cy="80" r="60" stroke="var(--border)" strokeWidth="0.5" opacity="0.3" />
      <circle cx="90" cy="80" r="40" stroke="var(--border)" strokeWidth="0.5" opacity="0.25" />
      <circle cx="90" cy="80" r="20" stroke="var(--border)" strokeWidth="0.5" opacity="0.2" />
      <circle cx="90" cy="80" r="4" fill="var(--vatic-indigo)" />
      {isInView && (
        <line x1="90" y1="80" x2="90" y2="20" stroke="var(--vatic-indigo)" strokeWidth="1" opacity="0.4" className="animate-radar" style={{ transformOrigin: "90px 80px" }} />
      )}
      {competitors.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r="4" fill={c.color} opacity="0.8">
          <animate attributeName="r" values="4;6;4" dur="2s" begin={c.delay} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0.4;0.8" dur="2s" begin={c.delay} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  )
}

/* ── SEO Traffic Chart SVG ────────────────────────────────────── */
function SEOChart() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: true })

  return (
    <svg ref={ref} viewBox="0 0 200 100" fill="none" className="w-full h-auto" aria-hidden="true">
      {/* Grid */}
      {[25, 50, 75].map((y) => (
        <line key={y} x1="10" y1={y} x2="190" y2={y} stroke="var(--border)" strokeWidth="0.5" opacity="0.3" />
      ))}

      {/* Area fill */}
      <path
        d="M10 85 L40 70 L70 75 L100 55 L130 45 L160 30 L190 20 L190 90 L10 90 Z"
        fill="var(--vatic-indigo)"
        opacity={isInView ? "0.12" : "0"}
        style={{ transition: "opacity 1s ease-out 0.5s" }}
      />

      {/* Line */}
      <path
        d="M10 85 L40 70 L70 75 L100 55 L130 45 L160 30 L190 20"
        stroke="var(--vatic-indigo)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="300"
        strokeDashoffset={isInView ? "0" : "300"}
        style={{ transition: "stroke-dashoffset 1.5s ease-out" }}
      />

      {/* Endpoint */}
      <circle cx="190" cy="20" r="3" fill="var(--vatic-indigo)" opacity={isInView ? "1" : "0"} style={{ transition: "opacity 0.3s ease-out 1.5s" }} />
    </svg>
  )
}

/* ── Menu Price Bars SVG ──────────────────────────────────────── */
function MenuBars() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: true })

  const bars = [
    { label: "Entrée", you: 75, them: 60 },
    { label: "Appetizer", you: 50, them: 65 },
    { label: "Dessert", you: 40, them: 45 },
    { label: "Drinks", you: 55, them: 35 },
  ]

  return (
    <svg ref={ref} viewBox="0 0 180 140" fill="none" className="w-full h-auto" aria-hidden="true">
      {bars.map((bar, i) => {
        const y = 10 + i * 32
        return (
          <g key={i}>
            <text x="4" y={y + 10} fontSize="8" fill="var(--muted-foreground)" opacity="0.6" fontFamily="Inter, sans-serif">{bar.label}</text>
            <rect x="55" y={y} width={bar.you} height="10" rx="3" fill="var(--vatic-indigo)" opacity={isInView ? "0.7" : "0"}
              style={{ transformOrigin: "55px center", transition: `opacity 0.5s ease-out ${0.1 * i}s` }} />
            <rect x="55" y={y + 14} width={bar.them} height="10" rx="3" fill="var(--signal-gold)" opacity={isInView ? "0.5" : "0"}
              style={{ transformOrigin: "55px center", transition: `opacity 0.5s ease-out ${0.1 * i + 0.15}s` }} />
          </g>
        )
      })}
      {/* Legend */}
      <circle cx="60" cy="138" r="3" fill="var(--vatic-indigo)" opacity="0.7" />
      <text x="67" y="140" fontSize="7" fill="var(--muted-foreground)" fontFamily="Inter, sans-serif">You</text>
      <circle cx="95" cy="138" r="3" fill="var(--signal-gold)" opacity="0.5" />
      <text x="102" y="140" fontSize="7" fill="var(--muted-foreground)" fontFamily="Inter, sans-serif">Competitor avg</text>
    </svg>
  )
}

/* ── Social Engagement Rings SVG ──────────────────────────────── */
function SocialRings() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: true })

  const platforms = [
    { cx: 40, label: "IG", pct: 0.72, color: "var(--vatic-indigo)" },
    { cx: 100, label: "FB", pct: 0.45, color: "var(--precision-teal)" },
    { cx: 160, label: "TK", pct: 0.88, color: "var(--signal-gold)" },
  ]
  const r = 22
  const circumference = 2 * Math.PI * r

  return (
    <svg ref={ref} viewBox="0 0 200 80" fill="none" className="w-full h-auto" aria-hidden="true">
      {platforms.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy="36" r={r} stroke="var(--border)" strokeWidth="3" opacity="0.2" />
          <circle
            cx={p.cx} cy="36" r={r}
            stroke={p.color}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={isInView ? circumference * (1 - p.pct) : circumference}
            transform={`rotate(-90 ${p.cx} 36)`}
            style={{ transition: `stroke-dashoffset 1.2s ease-out ${0.2 * i}s` }}
          />
          <text x={p.cx} y="40" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--foreground)" fontFamily="Inter, sans-serif">
            {p.label}
          </text>
          <text x={p.cx} y="72" textAnchor="middle" fontSize="8" fill="var(--muted-foreground)" fontFamily="Inter, sans-serif">
            {Math.round(p.pct * 100)}%
          </text>
        </g>
      ))}
    </svg>
  )
}

/* ── Photo Grid with Scan Line SVG ────────────────────────────── */
function PhotoGrid() {
  return (
    <svg viewBox="0 0 180 140" fill="none" className="w-full h-auto" aria-hidden="true">
      {/* 2x2 image placeholder grid */}
      <rect x="8" y="8" width="76" height="44" rx="6" fill="var(--muted)" opacity="0.3" />
      <rect x="96" y="8" width="76" height="44" rx="6" fill="var(--muted)" opacity="0.3" />
      <rect x="8" y="60" width="76" height="44" rx="6" fill="var(--muted)" opacity="0.3" />
      <rect x="96" y="60" width="76" height="44" rx="6" fill="var(--muted)" opacity="0.3" />

      {/* Camera icons in each cell */}
      {[
        { x: 36, y: 22 },
        { x: 124, y: 22 },
        { x: 36, y: 74 },
        { x: 124, y: 74 },
      ].map((pos, i) => (
        <g key={i} transform={`translate(${pos.x}, ${pos.y})`}>
          <rect x="-8" y="0" width="16" height="12" rx="2" stroke="var(--muted-foreground)" strokeWidth="1" opacity="0.3" fill="none" />
          <circle cx="0" cy="6" r="3" stroke="var(--muted-foreground)" strokeWidth="1" opacity="0.3" fill="none" />
        </g>
      ))}

      {/* Scan line */}
      <rect x="8" y="0" width="164" height="3" fill="var(--vatic-indigo)" opacity="0.35" rx="1.5" className="animate-scan-line" />

      {/* Quality badge -- below the grid */}
      <rect x="50" y="116" width="80" height="18" rx="9" fill="var(--vatic-indigo)" opacity="0.15" />
      <text x="90" y="128" textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--vatic-indigo)" fontFamily="Inter, sans-serif">AI Analyzed</text>
    </svg>
  )
}

/* ── Traffic Heatmap SVG ──────────────────────────────────────── */
function TrafficHeatmap() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: true })

  const days = ["M", "T", "W", "T", "F", "S", "S"]
  const hours = ["9a", "12p", "3p", "6p", "9p"]
  const intensities = [
    [0.2, 0.5, 0.3, 0.7, 0.9],
    [0.3, 0.6, 0.4, 0.8, 0.7],
    [0.2, 0.7, 0.5, 0.9, 0.8],
    [0.4, 0.6, 0.5, 0.8, 0.6],
    [0.5, 0.8, 0.7, 1.0, 0.9],
    [0.6, 0.9, 0.8, 0.9, 0.7],
    [0.4, 0.7, 0.6, 0.5, 0.3],
  ]

  return (
    <svg ref={ref} viewBox="0 0 200 140" fill="none" className="w-full h-auto" aria-hidden="true">
      {/* Hour labels */}
      {hours.map((h, j) => (
        <text key={j} x={42 + j * 30} y="12" textAnchor="middle" fontSize="7" fill="var(--muted-foreground)" opacity="0.5" fontFamily="Inter, sans-serif">{h}</text>
      ))}

      {/* Day labels + cells */}
      {days.map((d, i) => (
        <g key={i}>
          <text x="12" y={30 + i * 16} textAnchor="middle" fontSize="7" fill="var(--muted-foreground)" opacity="0.5" fontFamily="Inter, sans-serif">{d}</text>
          {intensities[i].map((intensity, j) => (
            <rect
              key={j}
              x={27 + j * 30}
              y={20 + i * 16}
              width="24"
              height="12"
              rx="2"
              fill="var(--vatic-indigo)"
              opacity={isInView ? intensity * 0.7 : 0}
              style={{ transition: `opacity 0.4s ease-out ${(i * 5 + j) * 0.03}s` }}
            />
          ))}
        </g>
      ))}

      {/* Legend */}
      <text x="12" y="138" fontSize="7" fill="var(--muted-foreground)" fontFamily="Inter, sans-serif">Low</text>
      <rect x="32" y="132" width="12" height="6" rx="1" fill="var(--vatic-indigo)" opacity="0.15" />
      <rect x="48" y="132" width="12" height="6" rx="1" fill="var(--vatic-indigo)" opacity="0.35" />
      <rect x="64" y="132" width="12" height="6" rx="1" fill="var(--vatic-indigo)" opacity="0.55" />
      <rect x="80" y="132" width="12" height="6" rx="1" fill="var(--vatic-indigo)" opacity="0.7" />
      <text x="100" y="138" fontSize="7" fill="var(--muted-foreground)" fontFamily="Inter, sans-serif">High</text>
    </svg>
  )
}

/* ── Features ─────────────────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
}

export function FeaturesSection() {
  return (
    <section id="features" className="py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp}
          className="mb-16 text-center"
        >
          <h2 className="font-display text-tight text-4xl italic text-foreground md:text-5xl">
            Six intelligence channels. One dashboard.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Every signal that matters. None of the noise.
          </p>
        </motion.div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">

          {/* Competitor Monitoring — 8 cols */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }} variants={fadeUp}
            className="group relative overflow-hidden rounded-xl border-l-4 border-signal-gold bg-card md:col-span-8"
          >
            <div className="flex h-full flex-col justify-between p-8 md:flex-row md:items-center md:gap-8">
              <div className="max-w-sm">
                <h3 className="font-display text-3xl italic text-foreground">Competitor Monitoring</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Track up to 50 competitors across Google, social media, and their websites. Daily snapshots catch changes the moment they happen — reviews, ratings, hours, attributes, and more.
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {["Reviews", "Ratings", "Menus", "Social", "SEO"].map((tag) => (
                    <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{tag}</span>
                  ))}
                </div>
              </div>
              <div className="mt-6 w-full max-w-[220px] md:mt-0">
                <CompetitorRadar />
              </div>
            </div>
          </motion.div>

          {/* SEO Visibility — 4 cols */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: 0.1 }} variants={fadeUp}
            className="flex flex-col justify-between rounded-xl bg-card border border-border/50 p-8 md:col-span-4"
          >
            <div>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--vatic-indigo)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <h3 className="mt-4 text-lg font-bold text-foreground">SEO Visibility</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Monitor local search dominance, keyword rankings, competitor overlap, and ad creatives.
              </p>
            </div>
            <div className="mt-4">
              <SEOChart />
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Organic Traffic</span>
                <span className="font-bold text-signal-gold">+23%</span>
              </div>
            </div>
          </motion.div>

          {/* Menu Intelligence — 4 cols */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: 0.05 }} variants={fadeUp}
            className="flex flex-col justify-between rounded-xl bg-card border border-border/50 p-8 md:col-span-4"
          >
            <div>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--signal-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
                <path d="M7 2v20" />
                <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
              </svg>
              <h3 className="mt-4 text-lg font-bold text-foreground">Menu & Content Intelligence</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Know when competitors change prices, add items, or launch promotions. Side-by-side comparison.
              </p>
            </div>
            <div className="mt-4">
              <MenuBars />
            </div>
          </motion.div>

          {/* Social Intelligence — 8 cols */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: 0.1 }} variants={fadeUp}
            className="group relative overflow-hidden rounded-xl bg-card border border-border/50 md:col-span-8"
          >
            <div className="flex h-full flex-col justify-between p-8 md:flex-row md:items-center md:gap-8">
              <div className="max-w-sm">
                <h3 className="font-display text-3xl italic text-foreground">Social Intelligence</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Beyond mentions. Track sentiment velocity across Instagram, Facebook, and TikTok to predict viral crises or opportunities before they peak.
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {["Instagram", "Facebook", "TikTok", "Engagement", "Sentiment"].map((tag) => (
                    <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{tag}</span>
                  ))}
                </div>
              </div>
              <div className="mt-6 w-full max-w-[240px] md:mt-0">
                <SocialRings />
              </div>
            </div>
          </motion.div>

          {/* Visual Intelligence — 6 cols */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: 0.05 }} variants={fadeUp}
            className="flex flex-col justify-between rounded-xl bg-card border border-border/50 p-8 md:col-span-6"
          >
            <div>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--precision-teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
              <h3 className="mt-4 text-lg font-bold text-foreground">Visual Intelligence</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                AI-powered photo analysis via Gemini Vision — quality scoring, ambiance detection, food presentation grading, and brand consistency audits.
              </p>
            </div>
            <div className="mt-4">
              <PhotoGrid />
            </div>
          </motion.div>

          {/* Foot Traffic — 6 cols */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: 0.1 }} variants={fadeUp}
            className="flex flex-col justify-between rounded-xl bg-card border border-border/50 p-8 md:col-span-6"
          >
            <div>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--vatic-indigo)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <h3 className="mt-4 text-lg font-bold text-foreground">Foot Traffic & Events</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Popular Times data, local event discovery, competitor match analysis. Plan staffing and promotions around real-time foot traffic intelligence.
              </p>
            </div>
            <div className="mt-4">
              <TrafficHeatmap />
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  )
}
