"use client"

import type { ReactNode } from "react"
import { useInView } from "@/components/ticket/use-in-view"

// Admin-overview viz islands, styled to The Pass (token-driven, animate 0→value
// on in-view, no-op under reduced-motion via useInView). Presentation only — they
// receive already-computed numbers from the server page.

/* ── Ranked horizontal bars (top insight types) ───────────── */
export function AdminBars({
  rows,
}: {
  rows: Array<{ label: ReactNode; value: number; pct: number }>
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <div className="adm-bars" ref={ref}>
      {rows.map((r, i) => (
        <div className="adm-bar" key={i}>
          <span className="adm-bar__label">{r.label}</span>
          <div className="adm-bar__track">
            <div
              className="adm-bar__fill"
              style={{ width: inView ? `${Math.max(2, r.pct)}%` : 0 }}
            />
          </div>
          <span className="adm-bar__val">{r.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Conversion funnel meters ──────────────────────────────── */
export function AdminFunnel({
  items,
}: {
  items: Array<{ label: ReactNode; pct: number; tone: "teal" | "gold" | "alert" }>
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <div className="adm-funnel" ref={ref}>
      {items.map((it, i) => (
        <div className="adm-funnel__item" key={i}>
          <div className="adm-funnel__cap">
            <span className="l">{it.label}</span>
            <span className="v">{it.pct}%</span>
          </div>
          <div className="adm-funnel__track">
            <div
              className={`adm-funnel__fill is-${it.tone}`}
              style={{ width: inView ? `${Math.max(2, it.pct)}%` : 0 }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Sparkbars (signups by week) ───────────────────────────── */
export function AdminSparkbars({
  bars,
}: {
  bars: Array<{ label: ReactNode; value: number; pct: number }>
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <div className="adm-sparkbars" ref={ref}>
      {bars.map((b, i) => (
        <div className="adm-sparkbars__col" key={i} title={`${b.value}`}>
          <div
            className="adm-sparkbars__bar"
            style={{ height: inView ? `${Math.max(4, (b.pct / 100) * 78)}px` : 4 }}
          />
          <span className="adm-sparkbars__lbl">{b.label}</span>
        </div>
      ))}
    </div>
  )
}
