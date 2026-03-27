"use client"

import { motion } from "framer-motion"
import { WaitlistForm } from "./waitlist-form"

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
}

export function WaitlistSection() {
  return (
    <section
      id="waitlist"
      className="relative overflow-hidden py-24 md:py-32"
    >
      <div className="landing-hero-ambient" />
      <div className="absolute inset-0 bg-vatic-indigo/5 opacity-30 pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-3xl px-8 text-center">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.1 } },
          }}
        >
          <motion.h2
            variants={fadeUp}
            className="font-display text-tight text-5xl italic text-foreground md:text-6xl"
          >
            Join the cohort.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 text-lg text-muted-foreground">
            Limited availability for early deployments. Secure your place in the queue.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          transition={{ delay: 0.15 }}
          variants={fadeUp}
          className="mt-12"
        >
          <WaitlistForm />
        </motion.div>
      </div>
    </section>
  )
}

export function LandingFooter() {
  return (
    <footer className="border-t border-border/30">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-8 px-8 py-12 md:flex-row md:justify-between">
        <div className="flex items-center gap-2.5">
          <svg width="24" height="24" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Vatic">
            <path d="M10 14 L40 66 L70 14" stroke="var(--vatic-indigo)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="40" cy="66" r="6" fill="var(--signal-gold)" />
          </svg>
          <span className="font-display text-xl italic tracking-tight text-signal-gold">Vatic</span>
        </div>

        <div className="flex flex-wrap justify-center gap-8">
          <a href="#" className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground">
            Privacy Protocol
          </a>
          <a href="#" className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground">
            Terms of Intelligence
          </a>
          <a href="#" className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground">
            API Docs
          </a>
          <a href="#" className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground">
            Contact Analyst
          </a>
        </div>

        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          &copy; 2026 Vatic Intelligence
        </p>
      </div>
    </footer>
  )
}
