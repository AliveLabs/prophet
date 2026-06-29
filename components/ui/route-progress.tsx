"use client"

// ALT-151 — global route-transition indicator.
//
// App Router navigations can take a beat (server components, data). Without a cue
// the shell feels dead after a click. This renders a subtle top progress bar that:
//   • STARTS when an internal link/nav is clicked (capture-phase click listener),
//   • CREEPS toward ~90% while the new route resolves,
//   • COMPLETES + fades once `usePathname()` changes (route committed).
//
// It does NOT wrap or intercept Link components and never blocks interaction
// (`pointer-events:none`). Themed (light+dark) and reduced-motion-safe via
// route-progress.css. Mounted once in the root layout.

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

type Phase = "idle" | "loading" | "done"

export default function RouteProgress() {
  const pathname = usePathname()
  const [phase, setPhase] = useState<Phase>("idle")
  const [width, setWidth] = useState(0)
  const trickleRef = useRef<number | null>(null)
  const doneTimerRef = useRef<number | null>(null)
  const prevPathRef = useRef(pathname)

  // Clear any pending timers.
  const clearTimers = () => {
    if (trickleRef.current != null) {
      window.clearInterval(trickleRef.current)
      trickleRef.current = null
    }
    if (doneTimerRef.current != null) {
      window.clearTimeout(doneTimerRef.current)
      doneTimerRef.current = null
    }
  }

  // Start the bar: jump to a visible head start, then trickle toward ~90%.
  const start = () => {
    clearTimers()
    setPhase("loading")
    setWidth(8)
    trickleRef.current = window.setInterval(() => {
      setWidth((w) => {
        if (w >= 90) return w
        // ease-out trickle: smaller increments as it nears the cap
        const remaining = 90 - w
        return w + Math.max(0.5, remaining * 0.06)
      })
    }, 220)
  }

  // Listen for clicks on internal navigations. Capture phase so we react before
  // the framework swallows the event; we only START the indicator (never preventDefault).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // ignore modified clicks / non-primary buttons (new tab, etc.)
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return
      }
      const target = e.target as Element | null
      const anchor = target?.closest?.("a")
      if (!anchor) return
      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#")) return
      if (anchor.getAttribute("target") === "_blank") return
      if (anchor.hasAttribute("download")) return
      // external / different-origin → real navigation, browser shows its own UI
      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin) return
      // same URL (including hash-only) → no route change to indicate
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return
      }
      start()
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Route committed: complete + fade out.
  useEffect(() => {
    if (pathname === prevPathRef.current) return
    prevPathRef.current = pathname
    clearTimers()
    setPhase("done")
    setWidth(100)
    doneTimerRef.current = window.setTimeout(() => {
      setPhase("idle")
      setWidth(0)
    }, 320)
  }, [pathname])

  useEffect(() => () => clearTimers(), [])

  return (
    <div
      className="route-progress"
      data-phase={phase}
      role="presentation"
      aria-hidden="true"
    >
      <div className="route-progress__bar" style={{ width: `${width}%` }} />
    </div>
  )
}
