"use client"

import { useEffect, useRef, useState } from "react"

// Count-up number that animates from 0 → value the first time it scrolls into view.
// Signals "live/working" without being noisy. Honors prefers-reduced-motion (jumps to
// final). Renders tabular-nums so the width doesn't jitter while counting.
//
// Formatting is intentionally SERIALIZABLE only (the `localize` boolean) — never a
// `format` function. A function prop cannot cross the server→client boundary, and
// this primitive is rendered by Server Components; a function would throw at request
// time ("Functions cannot be passed directly to Client Components"). Keep all knobs
// here serializable so misuse is a compile error, not a runtime crash.
//
// Usage: <AnimatedNumber value={1240} localize />
export function AnimatedNumber({
  value,
  localize = false,
  durationMs = 900,
  className,
  prefix = "",
  suffix = "",
}: {
  value: number
  // Render with thousands separators (n.toLocaleString()) instead of a raw number.
  localize?: boolean
  durationMs?: number
  className?: string
  prefix?: string
  suffix?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduce) {
      setDisplay(value)
      return
    }

    const run = () => {
      if (started.current) return
      started.current = true
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs)
        // easeOutCubic
        const eased = 1 - Math.pow(1 - t, 3)
        setDisplay(value * eased)
        if (t < 1) requestAnimationFrame(tick)
        else setDisplay(value)
      }
      requestAnimationFrame(tick)
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run()
          io.disconnect()
        }
      },
      { threshold: 0.2 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [value, durationMs])

  const n = Math.round(display)
  const rendered = localize ? n.toLocaleString() : String(n)
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}
      {rendered}
      {suffix}
    </span>
  )
}
