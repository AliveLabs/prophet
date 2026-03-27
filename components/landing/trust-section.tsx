"use client"

import { motion } from "framer-motion"

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
}

export function TrustSection() {
  return (
    <section id="trust" className="border-t border-border/50 py-24">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          variants={fadeUp}
          className="space-y-6"
        >
          <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Built for operators, not analysts.
          </h2>
          <div className="space-y-4 text-lg leading-relaxed text-muted-foreground">
            <p>
              Vatic was designed alongside restaurant owners who told us the same
              thing: &ldquo;I don&rsquo;t have time for another
              dashboard.&rdquo;
            </p>
            <p>
              That&rsquo;s why Vatic leads with what matters, not with charts.
              Every insight starts with what changed and ends with what to do
              about it.
            </p>
          </div>
          <p className="pt-4 text-sm font-medium text-muted-foreground">
            Powered by Google AI, Google Places, and real-time market data
          </p>
        </motion.div>
      </div>
    </section>
  )
}
