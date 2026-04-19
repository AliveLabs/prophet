"use client"

import { motion, useInView, useMotionValue, useTransform, animate } from "framer-motion"
import { useRef, useEffect } from "react"
import { MARKETING_STATS } from "@/lib/marketing/stats"

function Counter({ target, suffix = "", prefix = "" }: { target: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true })
  const count = useMotionValue(0)
  const rounded = useTransform(count, (v) => prefix + Math.round(v).toLocaleString() + suffix)

  useEffect(() => {
    if (!isInView) return
    const controls = animate(count, target, { duration: 2, ease: "easeOut" })
    return controls.stop
  }, [isInView, count, target])

  useEffect(() => {
    const unsubscribe = rounded.on("change", (v) => {
      if (ref.current) ref.current.textContent = v
    })
    return unsubscribe
  }, [rounded])

  return <span ref={ref}>{prefix}0{suffix}</span>
}

const METRICS = [
  {
    target: MARKETING_STATS.signalsDaily.value,
    suffix: MARKETING_STATS.signalsDaily.suffix,
    prefix: MARKETING_STATS.signalsDaily.prefix ?? "",
    label: MARKETING_STATS.signalsDaily.label,
  },
  {
    target: MARKETING_STATS.insightTypes.value,
    suffix: MARKETING_STATS.insightTypes.suffix,
    prefix: MARKETING_STATS.insightTypes.prefix ?? "",
    label: MARKETING_STATS.insightTypes.label,
  },
  {
    target: MARKETING_STATS.intelChannels.value,
    suffix: MARKETING_STATS.intelChannels.suffix,
    prefix: MARKETING_STATS.intelChannels.prefix ?? "",
    label: MARKETING_STATS.intelChannels.label,
  },
  {
    target: MARKETING_STATS.freeTrialDays.value,
    suffix: MARKETING_STATS.freeTrialDays.suffix,
    prefix: MARKETING_STATS.freeTrialDays.prefix ?? "",
    label: MARKETING_STATS.freeTrialDays.label,
  },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
}

export function TrustSection() {
  return (
    <section id="trust" className="border-y border-border/30 py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp}
          className="mb-16 text-center"
        >
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-accent">
            Not just what changed
          </p>
          <h2 className="font-display text-tight text-4xl leading-tight text-foreground md:text-5xl">
            <em className="italic">What to do about it.</em>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Ticket was designed alongside restaurant operators who told us the same thing:
            &ldquo;I don&rsquo;t have time for another dashboard.&rdquo;
            Every insight comes with a recommended next move — specific enough to act on Monday
            morning, scored so you know what&apos;s urgent and what can wait.
          </p>
        </motion.div>

        {/* Counter strip */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.1 } },
          }}
          className="grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8"
        >
          {METRICS.map((metric) => (
            <motion.div
              key={metric.label}
              variants={fadeUp}
              className="rounded-xl border border-border/50 bg-card p-6 text-center md:p-8"
            >
              <div className="text-3xl font-bold text-foreground md:text-4xl">
                <Counter target={metric.target} suffix={metric.suffix} prefix={metric.prefix} />
              </div>
              <div className="mt-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {metric.label}
              </div>
            </motion.div>
          ))}
        </motion.div>

        <motion.p
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          variants={fadeUp}
          className="mt-12 text-center text-sm text-muted-foreground"
        >
          Powered by Google AI, Google Places, DataForSEO, and real-time market data from 8+ intelligence sources.
        </motion.p>
      </div>
    </section>
  )
}
