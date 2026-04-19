"use client"

import { motion, useMotionValue, useTransform, animate, useInView } from "framer-motion"
import { useEffect, useRef } from "react"
import { MARKETING_STATS } from "@/lib/marketing/stats"

function AnimatedCounter({ target, suffix = "", duration = 2 }: { target: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true })
  const count = useMotionValue(0)
  const rounded = useTransform(count, (v) => Math.round(v).toLocaleString())

  useEffect(() => {
    if (!isInView) return
    const controls = animate(count, target, { duration, ease: "easeOut" })
    return controls.stop
  }, [isInView, count, target, duration])

  useEffect(() => {
    const unsubscribe = rounded.on("change", (v) => {
      if (ref.current) ref.current.textContent = v + suffix
    })
    return unsubscribe
  }, [rounded, suffix])

  return <span ref={ref}>0{suffix}</span>
}

function DashboardSVG() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })

  return (
    <svg
      ref={ref}
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      aria-hidden="true"
    >
      {/* Background card */}
      <rect x="0" y="0" width="400" height="280" rx="16" fill="var(--card)" opacity="0.6" />
      <rect x="0" y="0" width="400" height="280" rx="16" stroke="var(--border)" strokeWidth="1" />

      {/* Header bar */}
      <rect x="16" y="16" width="368" height="36" rx="8" fill="var(--muted)" opacity="0.5" />
      <circle cx="36" cy="34" r="4" fill="var(--vatic-indigo)" opacity="0.6" />
      <rect x="48" y="30" width="60" height="8" rx="4" fill="var(--muted-foreground)" opacity="0.3" />

      {/* KPI cards */}
      <rect x="16" y="64" width="112" height="56" rx="8" fill="var(--muted)" opacity="0.3" />
      <text x="28" y="84" fontSize="10" fill="var(--muted-foreground)" opacity="0.6" fontFamily="Inter, sans-serif">Competitors</text>
      <text x="28" y="106" fontSize="18" fontWeight="700" fill="var(--foreground)" fontFamily="Inter, sans-serif">
        {isInView ? "47" : "0"}
      </text>

      <rect x="144" y="64" width="112" height="56" rx="8" fill="var(--muted)" opacity="0.3" />
      <text x="156" y="84" fontSize="10" fill="var(--muted-foreground)" opacity="0.6" fontFamily="Inter, sans-serif">Insights</text>
      <text x="156" y="106" fontSize="18" fontWeight="700" fill="var(--foreground)" fontFamily="Inter, sans-serif">
        {isInView ? "238" : "0"}
      </text>

      <rect x="272" y="64" width="112" height="56" rx="8" fill="var(--muted)" opacity="0.3" />
      <text x="284" y="84" fontSize="10" fill="var(--muted-foreground)" opacity="0.6" fontFamily="Inter, sans-serif">SEO Score</text>
      <text x="284" y="106" fontSize="18" fontWeight="700" fill="var(--vatic-indigo)" fontFamily="Inter, sans-serif">
        {isInView ? "+23%" : "0%"}
      </text>

      {/* Line chart area */}
      <rect x="16" y="132" width="240" height="132" rx="8" fill="var(--muted)" opacity="0.2" />

      {/* Chart grid lines */}
      <line x1="32" y1="160" x2="240" y2="160" stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
      <line x1="32" y1="190" x2="240" y2="190" stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
      <line x1="32" y1="220" x2="240" y2="220" stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />

      {/* Animated line chart */}
      <path
        d="M32 230 L72 210 L112 220 L152 195 L192 180 L232 155"
        stroke="var(--vatic-indigo)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray="300"
        strokeDashoffset={isInView ? "0" : "300"}
        style={{ transition: "stroke-dashoffset 1.8s ease-out" }}
      />

      {/* Area fill under chart */}
      <path
        d="M32 230 L72 210 L112 220 L152 195 L192 180 L232 155 L232 248 L32 248 Z"
        fill="var(--vatic-indigo)"
        opacity={isInView ? "0.08" : "0"}
        style={{ transition: "opacity 1.5s ease-out 0.5s" }}
      />

      {/* Data points on chart */}
      {[
        { cx: 32, cy: 230 },
        { cx: 72, cy: 210 },
        { cx: 112, cy: 220 },
        { cx: 152, cy: 195 },
        { cx: 192, cy: 180 },
        { cx: 232, cy: 155 },
      ].map((p, i) => (
        <circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r="3"
          fill="var(--vatic-indigo)"
          opacity={isInView ? "1" : "0"}
          style={{ transition: `opacity 0.3s ease-out ${0.3 * i + 0.8}s` }}
        />
      ))}

      {/* Right side panel - signal feed */}
      <rect x="272" y="132" width="112" height="132" rx="8" fill="var(--muted)" opacity="0.2" />
      <text x="284" y="152" fontSize="9" fontWeight="600" fill="var(--muted-foreground)" opacity="0.6" fontFamily="Inter, sans-serif">LIVE SIGNALS</text>

      {/* Signal items */}
      <rect x="280" y="162" width="96" height="24" rx="6" fill="var(--vatic-indigo)" opacity="0.12" />
      <circle cx="290" cy="174" r="3" fill="var(--signal-gold)">
        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <rect x="298" y="170" width="70" height="4" rx="2" fill="var(--foreground)" opacity="0.4" />

      <rect x="280" y="194" width="96" height="24" rx="6" fill="var(--muted)" opacity="0.3" />
      <circle cx="290" cy="206" r="3" fill="var(--precision-teal)" opacity="0.7" />
      <rect x="298" y="202" width="55" height="4" rx="2" fill="var(--foreground)" opacity="0.3" />

      <rect x="280" y="226" width="96" height="24" rx="6" fill="var(--muted)" opacity="0.3" />
      <circle cx="290" cy="238" r="3" fill="var(--precision-teal)" opacity="0.7" />
      <rect x="298" y="234" width="65" height="4" rx="2" fill="var(--foreground)" opacity="0.3" />
    </svg>
  )
}

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
}

export function HeroSection() {
  return (
    <section
      id="hero"
      className="relative overflow-hidden pt-32 pb-24 md:pt-44 md:pb-32"
    >
      <div className="landing-hero-ambient" />

      <div className="relative z-10 mx-auto max-w-7xl px-8">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          {/* Left: Copy */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
          >
            <motion.h1
              variants={fadeUp}
              className="font-display text-tight text-5xl leading-[1.05] text-foreground md:text-7xl"
            >
              Know what&apos;s <em className="italic text-accent">firing</em>
              <br className="hidden md:block" /> before it hits your P&amp;L.
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mt-8 max-w-xl text-lg font-light leading-relaxed tracking-tight text-muted-foreground md:text-xl"
            >
              Ticket monitors competitor menus, pricing, reviews, and social — scored by confidence
              so you move first, not last.
            </motion.p>

            <motion.div variants={fadeUp} className="mt-10 flex flex-col gap-4 sm:flex-row sm:gap-6">
              <a
                href="#waitlist"
                className="vatic-gradient inline-flex items-center justify-center rounded-md px-8 py-4 text-lg font-bold tracking-tight text-white transition-transform hover:scale-[0.97]"
              >
                Request Early Access
              </a>
              <a
                href="#features"
                className="inline-flex items-center justify-center rounded-md border border-border/40 px-8 py-4 text-lg font-bold tracking-tight text-accent transition-colors hover:bg-muted/30"
              >
                See what Ticket watches
              </a>
            </motion.div>

            <motion.div variants={fadeUp} className="mt-12 flex gap-8">
              <div>
                <div className="text-2xl font-bold text-foreground">
                  <AnimatedCounter
                    target={MARKETING_STATS.signalsDaily.value}
                    suffix={MARKETING_STATS.signalsDaily.suffix}
                  />
                </div>
                <div className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {MARKETING_STATS.signalsDaily.shortLabel}
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  <AnimatedCounter
                    target={MARKETING_STATS.insightTypes.value}
                    suffix={MARKETING_STATS.insightTypes.suffix}
                  />
                </div>
                <div className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {MARKETING_STATS.insightTypes.shortLabel}
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  <AnimatedCounter
                    target={MARKETING_STATS.intelChannels.value}
                    suffix={MARKETING_STATS.intelChannels.suffix}
                  />
                </div>
                <div className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {MARKETING_STATS.intelChannels.shortLabel}
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* Right: Animated dashboard mockup */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative hidden lg:block"
          >
            <div className="editorial-shadow rounded-2xl">
              <DashboardSVG />
            </div>
            {/* Floating signal card */}
            <div className="glass-panel animate-float absolute -bottom-6 -left-8 max-w-[220px] rounded-xl p-5 editorial-shadow">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-block h-2 w-2 rounded-full bg-signal-gold animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-signal-gold">Signal Detected</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Competitor X dropped lunch prices 12% — 22 days before POS data reflected the decline.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
