"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { tkcx as cx } from "./primitives"

// Two tooltip APIs:
//
//  (1) <TkTooltipLayer/> — mount ONCE near the root of a Pass surface. It wires a
//      global pointer/touch listener that reads `data-tip` (+ optional `data-tipv`
//      highlighted value) off any hovered element and floats a single tip near the
//      cursor. This is the Concept-A pattern — many kit viz components already emit
//      `data-tip` / `data-tipv`, so they "just work" once this layer is present.
//      Hidden from AT (the underlying control should carry its own accessible name).
//
//  (2) <TkTooltip tip=… value=…>child</TkTooltip> — a focusable inline wrapper for
//      ad-hoc use; shows the same tip on hover AND keyboard focus.

/* ── (1) global layer ──────────────────────────────────────────────── */
export function TkTooltipLayer() {
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const tip = tipRef.current
    if (!tip) return
    let hideT: number | null = null

    // Float near the cursor (default).
    const move = (x: number, y: number) => {
      const pad = 14
      const w = tip.offsetWidth
      const h = tip.offsetHeight
      let left = x + 14
      let top = y - h - 10
      if (left + w + pad > window.innerWidth) left = x - w - 14
      if (top < pad) top = y + 18
      tip.style.left = `${left}px`
      tip.style.top = `${top}px`
    }
    // Anchor centered above the element's box (ALT-202b) — for discrete tiles
    // (e.g. the "at a glance" widgets) where a cursor-chasing tip reads as
    // detached/misaligned from the box it describes. The tip is position:fixed,
    // so element viewport rect (getBoundingClientRect) is the right space.
    const anchorTo = (el: Element) => {
      const pad = 14
      const w = tip.offsetWidth
      const h = tip.offsetHeight
      const r = el.getBoundingClientRect()
      let left = r.left + r.width / 2 - w / 2
      let top = r.top - h - 10
      if (left < pad) left = pad
      if (left + w + pad > window.innerWidth) left = window.innerWidth - w - pad
      if (top < pad) top = r.bottom + 10 // flip below when no room above
      tip.style.left = `${left}px`
      tip.style.top = `${top}px`
    }
    const showFor = (el: Element, x: number, y: number) => {
      const t = el.getAttribute("data-tip")
      if (!t) return
      const v = el.getAttribute("data-tipv")
      tip.textContent = ""
      if (v) {
        const s = document.createElement("span")
        s.className = "tk-tv"
        s.textContent = v
        tip.appendChild(s)
        tip.appendChild(document.createElement("br"))
      }
      tip.appendChild(document.createTextNode(t))
      tip.classList.add("tk-show")
      if (el.hasAttribute("data-tip-anchor")) anchorTo(el)
      else move(x, y)
    }
    const hide = () => tip.classList.remove("tk-show")

    const onMove = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]")
      if (el) showFor(el, e.clientX, e.clientY)
      else hide()
    }
    const onTouch = (e: TouchEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]")
      if (el) {
        const r = el.getBoundingClientRect()
        showFor(el, r.left + r.width / 2, r.top + r.height / 2)
        if (hideT) window.clearTimeout(hideT)
        hideT = window.setTimeout(hide, 2200)
      }
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("touchstart", onTouch, { passive: true })
    return () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("touchstart", onTouch)
      if (hideT) window.clearTimeout(hideT)
    }
  }, [])

  return <div ref={tipRef} className="tk-tip" role="status" aria-live="polite" />
}

/* ── (2) inline focusable wrapper ──────────────────────────────────── */
export function TkTooltip({
  tip,
  value,
  children,
  className,
}: {
  tip: string
  /** the highlighted mono value shown above the tip text */
  value?: string
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  const place = () => {
    const host = ref.current
    const tipEl = tipRef.current
    if (!host || !tipEl) return
    const r = host.getBoundingClientRect()
    const pad = 14
    let left = r.left + r.width / 2 + 14
    let top = r.top - tipEl.offsetHeight - 10
    if (left + tipEl.offsetWidth + pad > window.innerWidth)
      left = r.left - tipEl.offsetWidth - 14
    if (top < pad) top = r.bottom + 12
    tipEl.style.left = `${left}px`
    tipEl.style.top = `${top}px`
  }

  const open = () => {
    setShown(true)
    requestAnimationFrame(place)
  }
  const close = () => setShown(false)

  return (
    <span
      ref={ref}
      className={className}
      tabIndex={0}
      data-tip={tip}
      data-tipv={value}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {children}
      <span
        ref={tipRef}
        className={cx("tk-tip", shown && "tk-show")}
        role="status"
        aria-live="polite"
      >
        {value && <span className="tk-tv">{value}</span>}
        {value && <br />}
        {tip}
      </span>
    </span>
  )
}
