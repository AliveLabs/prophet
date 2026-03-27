"use client"

import { motion, useInView, useMotionValue, useTransform, animate } from "framer-motion"
import { useRef, useEffect } from "react"

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
  { target: 10000, suffix: "+", prefix: "", label: "Signals Monitored Daily" },
  { target: 50, suffix: "+", prefix: "", label: "Insight Types Generated" },
  { target: 6, suffix: "", prefix: "", label: "Intelligence Channels" },
  { target: 14, suffix: "-day", prefix: "", label: "Free Trial Included" },
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
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-signal-gold">
            The Standard of Excellence
          </p>
          <h2 className="font-display text-tight text-4xl italic leading-tight text-foreground md:text-5xl">
            Intelligence that speaks for itself.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Vatic was designed alongside restaurant owners who told us the same thing:
            &ldquo;I don&rsquo;t have time for another dashboard.&rdquo;
            That&rsquo;s why every insight starts with what changed and ends with what to do about it.
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
