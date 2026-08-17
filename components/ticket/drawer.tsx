"use client"

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
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
  portal = false,
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
  /** ALT-169: the wide PARTIAL-drawer variant (~60% of viewport on desktop, scrim over the
   *  still-visible page). The body copy is constrained to a readable max-width via `.tk-drawer-wide`
   *  so a widescreen drawer doesn't stretch text edge-to-edge. Default stays the narrow 560px form
   *  used by the form/detail drawers (locations, content screenshot, photo lightbox). */
  wide?: boolean
  /** Portal into the shell root (`.ticket-app`) instead of rendering in-tree. A fixed drawer left
   *  in-tree gets trapped by a transformed/animated ancestor (e.g. a card reveal in the pool) — the
   *  ancestor's containing block + stacking context re-anchored it to the content column and painted
   *  it BEHIND the sticky sidebar. Portaling to `.ticket-app` escapes that (viewport-anchored, z-index
   *  above the sidebar) while still inheriting the kit tokens + dark-mode class. Opt-in so the in-tree
   *  drawers that already render correctly are untouched. */
  portal?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const autoId = useId()
  const titleId = titleIdProp ?? `${autoId}-title`

  // restore focus when fully closed
  useEffect(() => {
    if (!open && openerRef.current) {
      openerRef.current.focus?.()
      openerRef.current = null
    }
  }, [open])

  // Portal host: the shell root (.ticket-app), matching the viz-tbubble pattern. As a
  // direct child of .ticket-app the drawer escapes .pv-main / any transformed card
  // ancestor (which trapped it in the content column, painting it behind the sidebar),
  // its fixed position resolves against the viewport, and its z-index:61 outranks the
  // sticky sidebar (z-index:30). It also inherits the design tokens + dark-mode class
  // already scoped to .ticket-app. Deferred to a frame so setState isn't synchronous in
  // the effect body (matches useReveal); the drawer starts closed, so there's no flash.
  //
  // HARDENING, not a fix for an observed failure: `document.querySelector(".ticket-app")`
  // takes the FIRST match, and under streaming SSR two `.ticket-app` roots can coexist with
  // the first one inside a `<div hidden>` (observed in dev on /preview/insight-card). Landing
  // the portal there would render the drawer inside a hidden subtree. Same family as the
  // querySelectorAll-counts-hidden-nodes trap. So: prefer a candidate outside `[hidden]`.
  //
  // ALT-632: this used to defer the lookup to a requestAnimationFrame. rAF DOES NOT FIRE while
  // the document is hidden, and the effect had `[portal]` for deps, so it never ran again: a
  // drawer whose component mounted in a backgrounded tab had `host === null` permanently, and
  // pressing "See the plan" rendered nothing at all. That is not hypothetical on this product,
  // where an operator waiting out a first run leaves the tab in the background by definition.
  //
  // Resolving directly in the effect is safe: setState in an effect BODY is fine (it is
  // render-phase setState that is forbidden), and the SSR case is already handled by the
  // `typeof document` guard, so there is no hydration mismatch to dodge. `open` joins the deps
  // so a drawer that somehow mounted before its host existed still finds one when it is opened.
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!portal || typeof document === "undefined") return
    const candidates = [...document.querySelectorAll<HTMLElement>(".ticket-app")]
    const live = candidates.find((el) => !el.closest("[hidden]")) ?? candidates[0]
    // document.body is the last resort and it is a BAD one: the kit's tokens are scoped to
    // .ticket-app, so a panel that lands on body has no --paper to paint with. The drawer's own
    // CSS now carries literal fallbacks for exactly that case (see .tk-drawer in pass.css), which
    // is what keeps this from rendering as a dark scrim over an invisible panel.
    setHost(live ?? document.body)
  }, [portal, open])

  // remember the opener, restore on close.
  // Gated on `portal ? host : true`: locking body scroll while the panel has nowhere to
  // render leaves the page frozen with nothing on screen, which is worse than a drawer that
  // opens a frame late.
  useEffect(() => {
    if (open && (!portal || host)) {
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
  }, [open, portal, host])

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

  const content = (
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

  // portal=true renders nothing until the host mounts (client-only); the drawer
  // starts closed, so there's no visible flash.
  if (portal) return host ? createPortal(content, host) : null
  return content
}
