"use client"

import { useEffect, useRef, useState } from "react"

// Small shared hook: returns a ref + whether the element has entered the
// viewport. Used by the viz islands to trigger their 0→value bar reveals.
//
// Reduced-motion / no-IO / SSR all resolve to `true` immediately so the data
// is shown at its final value (never stuck at 0).
export function useInView<T extends HTMLElement = HTMLElement>(threshold = 0.25) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

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

  return { ref, inView }
}
