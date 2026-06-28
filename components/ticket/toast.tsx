"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { tkcx as cx } from "./primitives"

// Pass-styled toast. Two ways to use it:
//
//  (1) Controlled <TkToast message=… show=… /> — render it yourself and flip `show`.
//  (2) Provider + hook (recommended for apps): wrap a subtree in <TkToastProvider>
//      and call `useTkToast()` to fire `toast(msg)` imperatively from anywhere.
//
// Honors reduced-motion via the CSS transition (which collapses to ~0ms there).

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

/* ── (1) controlled primitive ──────────────────────────────────────── */
export function TkToast({
  message,
  show,
  icon = true,
}: {
  message: ReactNode
  show: boolean
  icon?: boolean
}) {
  return (
    <div className={cx("tk-toast", show && "tk-show")} role="status" aria-live="polite">
      {icon && <CheckIcon />}
      {message}
    </div>
  )
}

/* ── (2) provider + hook ───────────────────────────────────────────── */
type TkToastFn = (message: ReactNode, durationMs?: number) => void
const TkToastCtx = createContext<TkToastFn | null>(null)

export function TkToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<ReactNode>(null)
  const [show, setShow] = useState(false)
  const timer = useRef<number | null>(null)

  const toast = useCallback<TkToastFn>((msg, durationMs = 2600) => {
    setMessage(msg)
    setShow(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShow(false), durationMs)
  }, [])

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  return (
    <TkToastCtx.Provider value={toast}>
      {children}
      <TkToast message={message} show={show} />
    </TkToastCtx.Provider>
  )
}

export function useTkToast(): TkToastFn {
  const ctx = useContext(TkToastCtx)
  if (!ctx) {
    // graceful no-op when used outside a provider (avoids hard crash)
    return () => {}
  }
  return ctx
}
