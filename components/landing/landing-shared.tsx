"use client"

// Shared client helpers for the Pass marketing landing.
// - LpReveal: a lightweight IntersectionObserver wrapper that toggles an
//   `lp-in-view` class for the page's data-reveal SVG animations and stagger
//   entrance. SSR-safe (starts visible) and a no-op under reduced-motion.
// - LpCount: count-up number for the hero / trust stats (reduced-motion safe).

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react"

function prefersReduced() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  )
}

export function LpReveal({
  children,
  className,
  as = "div",
  stagger = false,
  threshold = 0.18,
  ...rest
}: {
  children: ReactNode
  className?: string
  as?: ElementType
  /** stagger direct children (each child reads --lp-i for delay) */
  stagger?: boolean
  threshold?: number
} & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLDivElement>(null)
  // Start visible so SSR / no-JS shows content; hide+reveal only when armed.
  const [inView, setInView] = useState(true)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const hasIO =
      typeof window !== "undefined" && "IntersectionObserver" in window
    if (prefersReduced() || !hasIO) {
      setInView(true)
      return
    }
    setArmed(true)
    setInView(false)
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { threshold }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold])

  const classes = [
    armed ? (stagger ? "lp-anim-stagger" : "lp-anim") : "",
    inView ? "lp-in-view" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ")

  const Tag = as as "div"
  return (
    <Tag ref={ref} className={classes} {...rest}>
      {children}
    </Tag>
  )
}

export function LpCount({
  to,
  prefix = "",
  suffix = "",
  duration = 1600,
}: {
  to: number
  prefix?: string
  suffix?: string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [val, setVal] = useState(0)
  const done = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || done.current) return
    if (prefersReduced() || !("IntersectionObserver" in window)) {
      setVal(to)
      done.current = true
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || done.current) return
        done.current = true
        io.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / duration)
          // easeOutCubic
          const eased = 1 - Math.pow(1 - p, 3)
          setVal(Math.round(to * eased))
          if (p < 1) requestAnimationFrame(tick)
          else setVal(to)
        }
        requestAnimationFrame(tick)
      },
      { threshold: 0.4 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [to, duration])

  return (
    <span ref={ref}>
      {prefix}
      {val.toLocaleString()}
      {suffix}
    </span>
  )
}

/** child style helper for staggered reveals */
export function stIdx(i: number): CSSProperties {
  return { ["--lp-i" as string]: i } as CSSProperties
}
