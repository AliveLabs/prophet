"use client"

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react"
import { tkcx as cx } from "./primitives"

// Right-slide drawer on desktop, BOTTOM-SHEET on mobile (≤760, handled in
// pass.css). Controlled via `open` / `onClose`.
//   - scrim click + ESC close
//   - focus-trap-lite: focus the close button on open, Tab/Shift-Tab cycle
//     within the panel, restore focus to the opener on close
//   - aria-modal, role="dialog", body scroll lock while open
export function TkDrawer({
  open,
  onClose,
  chip,
  title,
  titleId: titleIdProp,
  children,
  className,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  /** the chip shown in the sticky glass header (e.g. <TkChip/>) */
  chip?: ReactNode
  /** accessible label for the dialog; rendered as <h2> in the body if you don't supply your own */
  title?: ReactNode
  titleId?: string
  children: ReactNode
  className?: string
  /** ALT-169: the wide PARTIAL-drawer variant (~78% of viewport on desktop, scrim over the
   *  still-visible page). The body copy is constrained to a readable max-width via `.tk-drawer-wide`
   *  so a widescreen drawer doesn't stretch text edge-to-edge. Default stays the narrow 560px form
   *  used by the form/detail drawers (locations, content screenshot, photo lightbox). */
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const autoId = useId()
  const titleId = titleIdProp ?? `${autoId}-title`

  // remember the opener, restore on close
  useEffect(() => {
    if (open) {
      openerRef.current = (document.activeElement as HTMLElement) ?? null
      // defer to allow the panel to mount/transition in
      const t = window.setTimeout(() => closeRef.current?.focus(), 30)
      document.body.style.overflow = "hidden"
      return () => {
        window.clearTimeout(t)
        document.body.style.overflow = ""
      }
    }
    return undefined
  }, [open])

  // restore focus when fully closed
  useEffect(() => {
    if (!open && openerRef.current) {
      openerRef.current.focus?.()
      openerRef.current = null
    }
  }, [open])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== "Tab") return
      const panel = panelRef.current
      if (!panel) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose]
  )

  return (
    <>
      <div
        className={cx("tk-scrim", open && "tk-open")}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className={cx("tk-drawer", wide && "tk-drawer-wide", open && "tk-open", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        onKeyDown={onKeyDown}
      >
        <div className="tk-drawer-head">
          <span className="tk-dh-chip">{chip}</span>
          <button
            ref={closeRef}
            type="button"
            className="tk-drawer-close"
            aria-label="Close detail"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="tk-drawer-body">
          {title != null && <h2 id={titleId}>{title}</h2>}
          {children}
        </div>
      </aside>
    </>
  )
}
