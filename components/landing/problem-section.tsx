"use client"

import { motion } from "framer-motion"

const SIGNAL_CARDS = [
  "Competitor added 4 new lunch specials under $12",
  "3-star review spike at nearby pizza spot",
  "New Google Ads campaign detected for 'best tacos near me'",
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
}

export function ProblemSection() {
  return (
    <section id="problem" className="border-t border-border/50 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2 lg:gap-16">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          variants={fadeUp}
          className="space-y-6"
        >
          <p className="text-sm font-semibold uppercase tracking-widest text-precision-teal">
            The Problem
          </p>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Your competitors change things every week. You find out months later.
          </h2>
          <div className="space-y-4 text-lg leading-relaxed text-muted-foreground">
            <p>
              New menu items. Price adjustments. Aggressive promotions. Review
              responses. Social media pushes. It all happens quietly, and by the
              time you notice, customers have already shifted.
            </p>
            <p>
              Most restaurant operators are too busy running the kitchen to
              monitor what&rsquo;s happening across the street. The tools that
              exist are built for marketing agencies, not for someone who needs
              answers in 5 minutes between the lunch and dinner rush.
            </p>
          </div>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          transition={{
            duration: 0.5,
            delay: 0.15,
            ease: [0.16, 1, 0.3, 1],
          }}
          variants={fadeUp}
          className="flex flex-col gap-4"
        >
          {SIGNAL_CARDS.map((card, i) => (
            <div
              key={i}
              className="signal-card rounded-lg border border-border px-5 py-4 text-sm font-medium text-foreground"
            >
              {card}
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
