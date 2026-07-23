"use client"

// Section-isolated photo gallery + carousel lightbox (ALT-449 / ALT-258).
// The Listing Check thumbnails were static and the "+N" tile did nothing. Each
// PhotoGallery instance owns its own photo list and open-index state, so opening
// a photo from "Your photos" cycles ONLY owner photos and "What customers posted"
// cycles ONLY customer photos — the two never bleed into one another.
//
// The lightbox mirrors the house TkDrawer conventions (portal into `.ticket-app`,
// focus-trap-lite, Esc + scrim close, body scroll lock, restore focus to the opener)
// and adds prev/next arrows, ←/→ keys, a counter, and touch swipe.

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { GalleryPhoto } from "@/lib/places/listing-audit"

const CAP = 8

function photoLabel(p: GalleryPhoto): string {
  return p.category ? p.category.replace(/_/g, " ") : "Listing photo"
}

// The clickable thumbnail strip. Same markup/classes as the old server-rendered
// PhotoGroup, but thumbs (and the "+N" tile) are buttons that open the lightbox.
export function PhotoGallery({
  title,
  photos,
  tone,
}: {
  title: string
  photos: GalleryPhoto[]
  tone: "own" | "cust"
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const shown = photos.slice(0, CAP)
  const overflow = photos.length - shown.length

  return (
    <div className={`img-gallery-group img-gallery-${tone}`}>
      <div className="img-gallery-head">
        <span>{title}</span>
        <span className="img-gallery-n">{photos.length}</span>
      </div>
      <div className="img-thumbs">
        {shown.map((p, i) => (
          <button
            type="button"
            className="img-thumb"
            key={`${p.url}-${i}`}
            title={photoLabel(p)}
            aria-label={`View ${photoLabel(p)} (${i + 1} of ${photos.length})`}
            onClick={() => setOpenIndex(i)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={photoLabel(p)} loading="lazy" />
          </button>
        ))}
        {overflow > 0 && (
          <button
            type="button"
            className="img-thumb img-thumb-more"
            // Opens at the first hidden photo so "+N" feels like "see the rest".
            aria-label={`View ${overflow} more ${title.toLowerCase()}`}
            onClick={() => setOpenIndex(CAP)}
          >
            +{overflow}
          </button>
        )}
      </div>
      <PhotoLightbox
        title={title}
        photos={photos}
        index={openIndex}
        onClose={() => setOpenIndex(null)}
        onIndex={setOpenIndex}
      />
    </div>
  )
}

function PhotoLightbox({
  title,
  photos,
  index,
  onClose,
  onIndex,
}: {
  title: string
  photos: GalleryPhoto[]
  index: number | null
  onClose: () => void
  onIndex: (i: number) => void
}) {
  const open = index != null
  const total = photos.length
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const touchX = useRef<number | null>(null)
  const autoId = useId()
  const titleId = `${autoId}-title`

  // Wrap-around navigation — from the last photo, "next" returns to the first.
  const go = useCallback(
    (delta: number) => {
      if (index == null || total === 0) return
      onIndex((index + delta + total) % total)
    },
    [index, total, onIndex],
  )

  // Portal host: the shell root (.ticket-app), matching TkDrawer/viz-tbubble — a fixed
  // overlay left in-tree gets trapped by a transformed/animated card ancestor.
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (typeof document === "undefined") return
    const id = requestAnimationFrame(() =>
      setHost(document.querySelector<HTMLElement>(".ticket-app") ?? document.body),
    )
    return () => cancelAnimationFrame(id)
  }, [])

  // Remember the opener, lock body scroll, focus the close button; restore on close.
  useEffect(() => {
    if (!open) return
    openerRef.current = (document.activeElement as HTMLElement) ?? null
    const t = window.setTimeout(() => closeRef.current?.focus(), 30)
    document.body.style.overflow = "hidden"
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = ""
    }
  }, [open])

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
      if (e.key === "ArrowRight") {
        e.preventDefault()
        go(1)
        return
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        go(-1)
        return
      }
      if (e.key !== "Tab") return
      const panel = panelRef.current
      if (!panel) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
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
    [onClose, go],
  )

  if (!open || !host) return null
  const photo = photos[index]
  if (!photo) return null
  const label = photoLabel(photo)
  const many = total > 1

  return createPortal(
    <div
      className="img-lbox tk-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
      <div className="img-lbox-scrim" onClick={onClose} aria-hidden="true" />
      <div className="img-lbox-panel" ref={panelRef}>
        <div className="img-lbox-bar">
          <span id={titleId} className="img-lbox-title">
            {title}
            {many && <span className="img-lbox-count">{index + 1} / {total}</span>}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="img-lbox-close"
            aria-label="Close photo viewer"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className="img-lbox-stage"
          onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null }}
          onTouchEnd={(e) => {
            const start = touchX.current
            touchX.current = null
            if (start == null || !many) return
            const dx = (e.changedTouches[0]?.clientX ?? start) - start
            if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
          }}
        >
          {many && (
            <button type="button" className="img-lbox-nav img-lbox-prev" aria-label="Previous photo" onClick={() => go(-1)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="img-lbox-img" src={photo.url} alt={label} />
          {many && (
            <button type="button" className="img-lbox-nav img-lbox-next" aria-label="Next photo" onClick={() => go(1)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          )}
        </div>

        {photo.category && <p className="img-lbox-cap">{label}</p>}
      </div>
    </div>,
    host,
  )
}
