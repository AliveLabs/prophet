// The panel a gated surface renders instead of a half-finished page (ALT-629).
//
// Deliberately dumb, like first-run-signals next door: every word it can say is decided by
// lib/onboarding/surface-readiness.ts, which is pure and unit-tested. This renders the result.
//
// It is a PANEL, not a skeleton. A skeleton draws the shape of an answer we do not have yet, and
// the shape is itself a claim: five grey rows say "there are five of these". The decision on the
// 2026-08-17 call was to show only finished data and no placeholders, so this says what is still
// running, in the operator's language, and nothing about what it will find.
//
// It also auto-refreshes. Without that, an operator who lands here during their first run sits on
// a dead page until they think to reload, which is the same abandonment the build screen was
// rebuilt to prevent. router.refresh() re-runs the server component, so the gate lifts on its own
// the moment the pulls settle.

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import type { SurfaceReadiness } from "@/lib/onboarding/surface-readiness"
import "./surface-not-ready.css"

/** Slow enough to cost nothing, fast enough that the page opens while they are still looking. */
const POLL_MS = 15_000

export default function SurfaceNotReady({
  readiness,
  title,
}: {
  readiness: SurfaceReadiness
  /** The page's own name, so the panel reads as this page rather than a generic spinner. */
  title: string
}) {
  const router = useRouter()

  useEffect(() => {
    if (readiness.state !== "working") return
    // Only poll while the tab is actually being looked at. A backgrounded tab refreshing every
    // fifteen seconds is a server read nobody sees.
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      router.refresh()
    }
    const id = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(id)
  }, [readiness.state, router])

  if (readiness.state !== "working") return null

  return (
    <section className="snr" aria-live="polite">
      <div className="snr-panel">
        <span className="snr-mark" aria-hidden="true" />
        <h1 className="snr-title">{title}</h1>
        <p className="snr-head">{readiness.headline}</p>
        <p className="snr-detail">{readiness.detail}</p>
        {readiness.pending.length > 1 && (
          <ul className="snr-list">
            {readiness.pending.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <p className="snr-foot">This page opens itself as soon as it is ready. You can keep working elsewhere.</p>
      </div>
    </section>
  )
}
