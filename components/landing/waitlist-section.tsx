"use client"

import { motion } from "framer-motion"
import { WaitlistForm } from "./waitlist-form"
import { TicketLogo } from "@/components/brand/ticket-logo"

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
            className="font-display text-tight text-5xl text-foreground md:text-6xl"
          >
            Stop reacting. <em className="italic">Start anticipating.</em>
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 text-lg text-muted-foreground">
            Your competition moves faster than your current tools can track. Ticket closes the gap
            so you move first, not last.
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
          <TicketLogo size={22} className="text-foreground" />
          <span className="text-wordmark text-xl font-semibold tracking-tight text-foreground">Ticket</span>
        </div>

        <p className="max-w-xs text-center text-xs tracking-wide text-muted-foreground md:text-right">
          Ticket is powered by Vatic — competitive intelligence by Alive Labs.
          <br />
          &copy; 2026 Alive Labs. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
