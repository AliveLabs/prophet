"use client"

import { motion } from "framer-motion"
import { WaitlistForm } from "./waitlist-form"

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
}

export function WaitlistSection() {
  return (
    <section
      id="waitlist"
      className="relative border-t border-border/50 py-24"
    >
      <div className="landing-hero-ambient" />
      <div className="relative z-10 mx-auto max-w-6xl px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          variants={fadeUp}
          className="mb-10 text-center"
        >
          <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Get early access.
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            First 500 signups get priority access and a launch discount.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          transition={{
            duration: 0.5,
            delay: 0.1,
            ease: [0.16, 1, 0.3, 1],
          }}
          variants={fadeUp}
        >
          <WaitlistForm />
        </motion.div>
      </div>
    </section>
  )
}

export function LandingFooter() {
  return (
    <footer className="border-t border-border/50 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-center text-sm text-muted-foreground md:flex-row md:justify-between md:text-left">
        <p>&copy; 2026 Vatic. All rights reserved.</p>
        <div className="flex gap-6">
          <a href="#" className="transition-colors hover:text-foreground">
            Privacy Policy
          </a>
          <a href="#" className="transition-colors hover:text-foreground">
            Terms of Service
          </a>
        </div>
        <p>Built by Alive Labs</p>
      </div>
    </footer>
  )
}
