"use client"

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
}

function NoiseToSignalSVG() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: true, margin: "-80px" })

  const bars = [
    { width: 65, delay: 0 },
    { width: 82, delay: 0.05 },
    { width: 45, delay: 0.1 },
    { width: 90, delay: 0.15 },
    { width: 55, delay: 0.2 },
    { width: 72, delay: 0.25 },
    { width: 38, delay: 0.3 },
  ]

  return (
    <svg
      ref={ref}
      viewBox="0 0 360 260"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="360" height="260" rx="16" fill="var(--card)" opacity="0.5" />
      <rect x="0" y="0" width="360" height="260" rx="16" stroke="var(--border)" strokeWidth="1" />

      {/* Noise label */}
      <text x="24" y="32" fontSize="10" fontWeight="600" fill="var(--muted-foreground)" opacity="0.5" fontFamily="Inter, sans-serif" letterSpacing="0.1em">
        RAW MARKET DATA
      </text>

      {/* Noise bars */}
      {bars.map((bar, i) => (
        <g key={i}>
          <rect
            x="24"
            y={48 + i * 28}
            width={`${bar.width}%`}
            height="18"
            rx="4"
            fill="var(--muted-foreground)"
            opacity={isInView ? "0.12" : "0"}
            style={{
              transformOrigin: "24px center",
              transition: `opacity 0.4s ease-out ${bar.delay}s`,
            }}
          />
        </g>
      ))}

      {/* Signal bar (the gold one) */}
      <rect
        x="24"
        y={48 + 3 * 28}
        width="70%"
        height="18"
        rx="4"
        fill="var(--signal-gold)"
        opacity={isInView ? "0.35" : "0"}
        style={{ transition: "opacity 0.6s ease-out 0.5s" }}
      />
      <text
        x="36"
        y={48 + 3 * 28 + 13}
        fontSize="9"
        fontWeight="700"
        fill="var(--signal-gold)"
        letterSpacing="0.12em"
        opacity={isInView ? "1" : "0"}
        style={{ transition: "opacity 0.6s ease-out 0.7s" }}
      >
        SIGNAL DETECTED
      </text>
    </svg>
  )
}

export function ProblemSection() {
  return (
    <section id="problem" className="py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-8">
        <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-24">
          {/* Left: Copy */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.1 } },
            }}
          >
            <motion.div variants={fadeUp} className="mb-8 h-[2px] w-12 bg-signal-gold" />
            <motion.h2
              variants={fadeUp}
              className="font-display text-tight text-4xl italic leading-tight text-foreground md:text-5xl lg:text-6xl"
            >
              The noise is deafening.
              <br />
              The signal is silent.
            </motion.h2>
            <motion.p
              variants={fadeUp}
              className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground"
            >
              Traditional monitoring systems report on what happened last quarter.
              By the time you see the trend, your competitors have already captured the territory.
            </motion.p>
            <motion.p
              variants={fadeUp}
              className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground"
            >
              Vatic operates on the threshold of intent, identifying micro-signals across
              digital ecosystems to provide a prescient view of the competitive landscape.
            </motion.p>
          </motion.div>

          {/* Right: Visualization */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <div className="editorial-shadow rounded-xl overflow-hidden">
              <NoiseToSignalSVG />
            </div>

            {/* Floating insight card -- positioned below the SVG */}
            <div className="animate-float mt-6 ml-0 lg:-ml-6 max-w-[280px] rounded-xl p-5 editorial-shadow border border-border bg-card">
              <div className="flex items-center gap-2 mb-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--signal-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                <h4 className="text-sm font-bold text-foreground">Prescient Action</h4>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Vatic identified a 14% shift in local menu sentiment 22 days before traditional
                POS data reflected the decline.
              </p>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-signal-gold">
                22 days ahead of traditional analysis
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
