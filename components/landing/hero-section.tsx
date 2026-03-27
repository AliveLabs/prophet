"use client"

import { motion } from "framer-motion"

export function HeroSection() {
  return (
    <section
      id="hero"
      className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden pt-16"
    >
      <div className="landing-hero-ambient" />

      <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-8"
        >
          <h1 className="font-display text-5xl font-semibold leading-[1.1] tracking-tight text-foreground md:text-7xl">
            Know what your competitors did this week.
          </h1>

          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            Vatic monitors your local market daily and delivers the 5 things you
            need to know every week. No dashboards to learn. No data to
            interpret. Just clear, actionable intelligence.
          </p>

          <div className="flex flex-col items-center gap-4">
            <a
              href="#waitlist"
              className="inline-flex rounded-xl bg-precision-teal px-8 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:opacity-90 hover:shadow-xl"
            >
              Join the Waitlist &mdash; Free Early Access
            </a>
            <p className="text-sm text-muted-foreground">
              No credit card required. First 500 get a discount.
            </p>
          </div>
        </motion.div>

        {/* Example insight card */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-16 max-w-md"
        >
          <div className="glass-card rounded-xl border border-border p-5 text-left shadow-lg">
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-precision-teal" />
              <span className="text-xs font-semibold uppercase tracking-wider text-precision-teal">
                New Insight
              </span>
            </div>
            <p className="text-sm font-medium text-foreground">
              Competitor X dropped prices 12% on lunch specials this week.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Confidence: High
              </span>
              <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Severity: Warning
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
