"use client"

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

function RadarIcon() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: false })

  return (
    <svg ref={ref} width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="20" stroke="var(--border)" strokeWidth="1" opacity="0.4" />
      <circle cx="24" cy="24" r="14" stroke="var(--border)" strokeWidth="1" opacity="0.3" />
      <circle cx="24" cy="24" r="8" stroke="var(--border)" strokeWidth="1" opacity="0.2" />
      <circle cx="24" cy="24" r="2.5" fill="var(--vatic-indigo)" />
      {isInView && (
        <line
          x1="24" y1="24" x2="24" y2="4"
          stroke="var(--vatic-indigo)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.7"
          className="animate-radar"
          style={{ transformOrigin: "24px 24px" }}
        />
      )}
      <circle cx="18" cy="12" r="2" fill="var(--signal-gold)" opacity="0.8">
        <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx="34" cy="16" r="2" fill="var(--precision-teal)" opacity="0.7">
        <animate attributeName="opacity" values="0.7;0.2;0.7" dur="2.5s" repeatCount="indefinite" />
      </circle>
      <circle cx="30" cy="34" r="2" fill="var(--vatic-indigo-soft)" opacity="0.6">
        <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.8s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

function PrismIcon() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: true })

  return (
    <svg ref={ref} width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      {/* Input lines converging */}
      <line x1="4" y1="10" x2="24" y2="24" stroke="var(--muted-foreground)" strokeWidth="1" opacity="0.3"
        strokeDasharray="30" strokeDashoffset={isInView ? "0" : "30"}
        style={{ transition: "stroke-dashoffset 0.8s ease-out 0.2s" }} />
      <line x1="4" y1="24" x2="24" y2="24" stroke="var(--muted-foreground)" strokeWidth="1" opacity="0.3"
        strokeDasharray="20" strokeDashoffset={isInView ? "0" : "20"}
        style={{ transition: "stroke-dashoffset 0.8s ease-out 0.3s" }} />
      <line x1="4" y1="38" x2="24" y2="24" stroke="var(--muted-foreground)" strokeWidth="1" opacity="0.3"
        strokeDasharray="30" strokeDashoffset={isInView ? "0" : "30"}
        style={{ transition: "stroke-dashoffset 0.8s ease-out 0.4s" }} />

      {/* Prism */}
      <polygon points="20,14 28,14 28,34 20,34" fill="var(--vatic-indigo)" opacity="0.15" stroke="var(--vatic-indigo)" strokeWidth="1.5" />

      {/* Output line - single focused signal */}
      <line x1="28" y1="24" x2="44" y2="24" stroke="var(--vatic-indigo)" strokeWidth="2" strokeLinecap="round"
        strokeDasharray="16" strokeDashoffset={isInView ? "0" : "16"}
        style={{ transition: "stroke-dashoffset 0.6s ease-out 0.7s" }} />
      <circle cx="44" cy="24" r="3" fill="var(--vatic-indigo)"
        opacity={isInView ? "1" : "0"}
        style={{ transition: "opacity 0.3s ease-out 1s" }} />
    </svg>
  )
}

function LightningIcon() {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: true })

  return (
    <svg ref={ref} width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M26 4 L14 26 H22 L18 44 L36 20 H26 Z"
        fill="var(--signal-gold)"
        opacity={isInView ? "0.2" : "0"}
        stroke="var(--signal-gold)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        style={{ transition: "opacity 0.4s ease-out 0.3s" }}
      />
      {isInView && (
        <path
          d="M26 4 L14 26 H22 L18 44 L36 20 H26 Z"
          fill="var(--signal-gold)"
          opacity="0.4"
          strokeLinejoin="round"
        >
          <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="3" />
        </path>
      )}
    </svg>
  )
}

const STEPS = [
  {
    number: "01",
    icon: <RadarIcon />,
    title: "Name your set",
    description:
      "Your restaurant plus up to ten competitors. Takes five minutes. Ticket starts watching menus, pricing, reviews, social, and local search the moment you finish.",
  },
  {
    number: "02",
    icon: <PrismIcon />,
    title: "Signals scored",
    description:
      "Every shift is classified High, Medium, or Directional — multi-source verification filters the noise so you only see what&apos;s worth a second look.",
  },
  {
    number: "03",
    icon: <LightningIcon />,
    title: "Briefings land",
    description:
      "Daily alerts with what changed, why it matters, and what to do next. Priority-scored, confidence-rated, and tied to a specific next move you can make Monday morning.",
  },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
}

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-muted/30 py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp}
          className="mb-20 text-center"
        >
          <h2 className="font-display text-tight text-4xl text-foreground md:text-5xl">
            Setup to first alert: <em className="italic">48 hours.</em>
          </h2>
          <p className="mt-4 text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            How Ticket works
          </p>
        </motion.div>

        <div className="grid gap-12 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => (
            <motion.div
              key={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.12 }}
              variants={fadeUp}
              className="group text-center"
            >
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-card border border-border/50">
                {step.icon}
              </div>
              <div className="mb-4 font-display text-5xl italic text-muted-foreground/20 transition-colors group-hover:text-vatic-indigo/50">
                {step.number}
              </div>
              <h3 className="mb-4 text-xl font-bold text-foreground">
                {step.title}
              </h3>
              <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
