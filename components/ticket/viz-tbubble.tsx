"use client"

// ALT-230 — the "Ask Ticket about this" T-bubble.
//
// A small Ticket-T speech-bubble button that sits in the top-right corner of any
// NON-INSIGHT data-viz card. Clicking opens an inline popover OVER the card
// (Figma-comment style — it does NOT navigate away) offering two actions:
//   1. Generate insight + recommendation  — kicks off a LIVE generation; we route to
//      /insights where a placeholder spins at the top of the pool, then populates with
//      the new insight (the engine path is wired in app/(dashboard)/insights).
//   2. Ask Ticket about this  — routes to /ask with a pre-filled, EDITABLE question
//      about this exact data (the existing ?q= contract — ALT-183).
//
// Boundary: the kit cards (TkWidget/TkCard/TkHero) stay SERVER components; they accept
// this client island AS A NODE via their `tBubble` slot, so no handler crosses the RSC
// boundary. The popover is `position: fixed` and rendered IN-TREE (never portaled to
// document.body) so the `.ticket-app` design tokens + `.ticket-app.dark` dark mode keep
// resolving — while fixed positioning escapes the widget's `overflow:hidden` clip.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { TicketLogo } from "@/components/brand/ticket-logo"
import { tkcx as cx } from "./primitives"

// The token surfaces that define --rust/--card/… (and carry `.dark`). We portal the
// popover into the NEAREST one so it (a) escapes a viz card's overflow:hidden AND any
// transformed ancestor (e.g. `.pv-page`, which traps position:fixed), while (b) keeping
// the design tokens + dark mode resolving — `.ticket-app.dark` is on this same element.
const TOKEN_SURFACE = ".ticket-app, .ticket-brief, .ob, .ticket-chrome"

/* The data a viz card knows about itself — fed to both actions so the generated
   insight / pre-filled question is about THIS exact visualization. Serializable
   (no functions): a card computes it at render time and passes it in. */
export type VizDomain =
  | "weather"
  | "traffic"
  | "social"
  | "competitors"
  | "events"
  | "content"
  | "visibility"
  | "menu"
  | "overview"

export type VizContext = {
  domain: VizDomain
  /** human label for the metric/card, e.g. "Avg high", "Busiest competitor" */
  metric: string
  /** the current value shown, if any (string or number) */
  value?: string | number | null
  /** unit suffix for the value, e.g. "°F", "%" */
  unit?: string
  entityType?: "location" | "competitor" | "event" | "platform"
  /** the thing this card is about, e.g. a competitor or event name */
  entityName?: string
  entityId?: string
  /** human timeframe, e.g. "this week", "12 days history + 1 day forecast" */
  timeframe?: string
  /** where the data came from, e.g. "OpenWeatherMap" */
  source?: string
  /** the location this viz belongs to (the generate endpoint validates + falls back) */
  locationId?: string
}

/* A plain-language, jargon-free question for the Ask flow.
   No restaurant/kitchen lingo (CHEF_LINGO / lintVoice gate — see MEMORY). */
export function buildAskQuestion(v: VizContext): string {
  const val =
    v.value != null && v.value !== "" ? ` of ${v.value}${v.unit ?? ""}` : ""
  const m = String(v.metric).toLowerCase()
  switch (v.domain) {
    case "weather":
      return `What does my ${m}${val} mean for foot traffic this week, and what should I do about it?`
    case "traffic":
      return v.entityName
        ? `How does ${v.entityName}'s foot traffic compare to mine right now, and what should I do about it?`
        : `What is my ${m}${val} telling me about foot traffic, and what should I do about it?`
    case "social":
      return v.entityName
        ? `What should I take away from ${v.entityName}'s social activity, and how should I respond?`
        : `What does my ${m}${val} on social mean, and how do I improve it?`
    case "competitors":
      return v.entityName
        ? `What should I know about ${v.entityName} right now, and how should I respond?`
        : `What does my ${m}${val} tell me about my competitors, and how should I respond?`
    case "events":
      return v.entityName
        ? `How will ${v.entityName} affect my demand, and how should I prepare?`
        : `What do nearby events mean for my demand${val}, and how should I prepare?`
    case "menu":
      return `What does my ${m}${val} mean versus my competitors, and what should I do about it?`
    default:
      return `What does my ${m}${val} mean for my business, and what should I do about it?`
  }
}

const POP_W = 272

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 16l.7 1.9L21.6 18.6l-1.9.7L19 21l-.7-1.7-1.9-.7 1.9-.7z" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function VizTBubble({
  viz,
  className,
}: {
  viz: VizContext
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false) // RAF mount-transition (matches TkDismissReason)
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const raf = useRef<number | null>(null)

  const aria = `Ask Ticket about ${viz.metric}`

  // Position the fixed popover off the button rect: opens down-left (right-aligned to
  // the button), flips above when the button sits low in the viewport. Clamped to stay
  // on-screen on small viewports.
  const place = useCallback(() => {
    const b = btnRef.current
    if (typeof window === "undefined" || !b) return
    const r = b.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.round(Math.min(Math.max(8, r.right - POP_W), Math.max(8, vw - POP_W - 8)))
    const openUp = r.bottom > vh * 0.62
    setPos(
      openUp
        ? { left, bottom: Math.round(vh - r.top + 8) }
        : { left, top: Math.round(r.bottom + 8) }
    )
  }, [])

  // While open: run the enter-transition RAF and wire global close listeners. State
  // resets (shown/host/pos) happen in the open handler, not here, so the effect body
  // holds no synchronous setState (react-hooks/set-state-in-effect). The popover
  // unmounts on close, so there's nothing to reset on the !open path.
  useEffect(() => {
    if (!open) return
    raf.current = requestAnimationFrame(() => setShown(true))

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    // A fixed popover would drift if the page scrolls behind it — close instead.
    // Capture phase catches scrolls from any nested scroll container, not just window.
    function onReflow() {
      setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDown)
    window.addEventListener("scroll", onReflow, true)
    window.addEventListener("resize", onReflow)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("scroll", onReflow, true)
      window.removeEventListener("resize", onReflow)
    }
  }, [open])

  function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!open) {
      // portal target = nearest token surface (escapes overflow:hidden + transformed
      // ancestors while keeping tokens/dark); fall back to body if somehow unscoped.
      setHost((btnRef.current?.closest(TOKEN_SURFACE) as HTMLElement | null) ?? document.body)
      setShown(false) // reset so the RAF enter-transition runs on this open
      place() // set position BEFORE mount so it never flashes off-screen
    }
    setOpen((v) => !v)
  }

  function onAsk() {
    setOpen(false)
    router.push(`/ask?q=${encodeURIComponent(buildAskQuestion(viz))}`)
  }

  function onGenerate() {
    if (busy) return
    setBusy(true)
    // Hand the viz context to /insights, which spins a placeholder at the top of the
    // pool and runs the live generation, then populates it in place (ALT-230 §3).
    const payload = encodeURIComponent(JSON.stringify(viz))
    router.push(`/insights?generate=${payload}`)
  }

  const hasValue = viz.value != null && viz.value !== ""

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cx("tk-tbub", open && "tk-tbub-open", className)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={aria}
        onClick={toggle}
      >
        <TicketLogo size={12} simplified />
      </button>

      {open && host
        ? createPortal(
        <div
          ref={popRef}
          className={cx("tk-tbub-pop", shown && "tk-open")}
          style={pos ?? { left: -9999, top: -9999 }}
          role="dialog"
          aria-label={aria}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="tk-tbub-ctx">
            <span className="tk-tbub-eyebrow">About this</span>
            <span className="tk-tbub-metric">
              <span>{viz.metric}</span>
              {hasValue ? (
                <b>
                  {String(viz.value)}
                  {viz.unit ?? ""}
                </b>
              ) : null}
            </span>
          </div>

          <button type="button" className="tk-tbub-opt tk-tbub-act" onClick={onGenerate} disabled={busy}>
            <span className="tk-tbub-ic" aria-hidden="true">
              <SparkIcon />
            </span>
            <span className="tk-tbub-lbl">
              <b>{busy ? "Generating…" : "Generate insight"}</b>
              <span>Turn this into a recommendation</span>
            </span>
          </button>

          <button type="button" className="tk-tbub-opt tk-tbub-ask" onClick={onAsk}>
            <span className="tk-tbub-ic" aria-hidden="true">
              <ChatIcon />
            </span>
            <span className="tk-tbub-lbl">
              <b>Ask Ticket about this</b>
              <span>Open a question you can edit</span>
            </span>
          </button>
        </div>,
            host
          )
        : null}
    </>
  )
}
