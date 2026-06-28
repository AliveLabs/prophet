"use client"

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ElementType,
  type HTMLAttributes,
} from "react"

// IntersectionObserver wrapper that adds `tk-in-view` to its element when it
// scrolls into view, driving the entrance fade-up and any data-reveal inside.
//
// MUST render fully-visible (in-view from the start) when:
//   - prefers-reduced-motion: reduce
//   - IntersectionObserver is unavailable (older browser)
//   - running on the server / first paint with no JS (SSR-safe: starts visible,
//     then JS hides+reveals only if motion is allowed and IO exists)
//
// `stagger` adds `tk-stagger` so direct children fade in on a per-index delay
// (each child should carry style={{ ["--tk-i"]: n } as CSSProperties}).
export function RevealOnView({
  children,
  className,
  as = "div",
  stagger = false,
  threshold = 0.2,
  once = true,
  ...rest
}: {
  children: ReactNode
  className?: string
  as?: ElementType
  stagger?: boolean
  threshold?: number
  once?: boolean
} & HTMLAttributes<HTMLElement>) {
  // Tag is cast to "div" below, so the ref is typed to match (the cast already
  // discards polymorphic ref-type safety; IO only needs an Element at runtime).
  const ref = useRef<HTMLDivElement>(null)
  // Start visible so SSR / no-JS shows content; the effect hides+animates only
  // when motion is allowed and IO is available.
  const [inView, setInView] = useState(true)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const hasIO = typeof window !== "undefined" && "IntersectionObserver" in window

    if (reduce || !hasIO) {
      setInView(true)
      return
    }

    // Arm the animation: hide, then reveal on intersection.
    setArmed(true)
    setInView(false)

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          if (once) io.disconnect()
        } else if (!once) {
          setInView(false)
        }
      },
      { threshold }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [threshold, once])

  const classes = [
    armed ? (stagger ? "tk-stagger" : "tk-reveal") : "",
    inView ? "tk-in-view" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ")

  // `as` is polymorphic; cast to a ref-accepting element type so the shared
  // HTMLElement ref + HTMLAttributes spread type-check across any host tag.
  const Tag = as as "div"

  return (
    <Tag ref={ref} className={classes} {...rest}>
      {children}
    </Tag>
  )
}
