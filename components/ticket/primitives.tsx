// Presentational, server-safe primitives for The Pass kit.
// No hooks / no handlers here (except via passthrough props) so these can render
// in server components. Interactive islands live in their own files.

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, HTMLAttributes } from "react"
import Link from "next/link"

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ")
}

/* ════════════════════════════════════════════════════════════════════
   TkCompetitorLink (ALT-192)
   A competitor's name, made a link to its detail page wherever it renders
   (briefs, insights, proof, traffic, …). Server-safe (next/link works in
   both). When no id is known we render the plain name — never a dead link —
   so non-competitor names and unresolved ids pass through untouched.
   ════════════════════════════════════════════════════════════════════ */
export function TkCompetitorLink({
  id,
  name,
  className,
  hrefBase = "/competitors",
}: {
  /** Competitor id. Null/undefined ⇒ render plain text (no link). */
  id?: string | null
  name: ReactNode
  className?: string
  hrefBase?: string
}) {
  if (!id) return <>{name}</>
  return (
    <Link href={`${hrefBase}/${id}`} className={cx("tk-comp-link", className)}>
      {name}
    </Link>
  )
}

/* ── families (shared union used across chips / icons) ───────────────── */
export type TkFamily =
  | "competitive"
  | "reputation"
  | "social"
  | "menu"
  | "grassroots"

/* ════════════════════════════════════════════════════════════════════
   TkButton — THE button system (ALT-252).

   Four PERMANENT visual tiers, decided 2026-07-01:
     primary    — filled copper gradient, knockout text: the ONE main action
     secondary  — copper outline, copper text + icons: a real alternative action
     tertiary   — thin gray outline + subtle shadow: calm utility (cancel/undo)
     borderless — copper text/icon only, SAME font size as every other button,
                  and deliberately NO hover treatment: the color alone carries
                  the affordance. A hover pill/underline would imply an extra
                  action that doesn't exist — a fake button in an already
                  complex UI (Bryan, 2026-07-01).
   Legacy names map onto the system (act→primary, add→secondary,
   ghost→tertiary) so existing call sites inherit it without churn.
   `keep`/`dismiss` stay as FUNCTIONAL variants (toggle state / destructive x).
   Spacing rule: a primary next to an adjacent borderless gets a 12px gap.
   ════════════════════════════════════════════════════════════════════ */
export type TkButtonVariant =
  | "primary" | "secondary" | "tertiary" | "borderless"
  | "act" | "add" | "ghost" // legacy aliases → primary/secondary/tertiary
  | "keep" | "dismiss"

const VARIANT_CLASS: Record<TkButtonVariant, string> = {
  primary: "primary",
  act: "primary",
  secondary: "secondary",
  add: "secondary",
  tertiary: "tertiary",
  ghost: "tertiary",
  borderless: "borderless",
  keep: "keep",
  dismiss: "dismiss",
}

export function TkButton({
  variant = "primary",
  kept = false,
  className,
  children,
  ...props
}: {
  variant?: TkButtonVariant
  /** for variant="keep": render the toggled (saved) state */
  kept?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "tk-btn",
        `tk-btn-${VARIANT_CLASS[variant]}`,
        variant === "keep" && kept && "tk-is-kept",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/** Anchor rendered as a system button — for link-actions like "Event details" /
 *  "Map it" that navigate rather than mutate. Same four tiers as TkButton. */
export function TkButtonLink({
  variant = "primary",
  className,
  children,
  ...props
}: {
  variant?: TkButtonVariant
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cx("tk-btn", `tk-btn-${VARIANT_CLASS[variant]}`, className)} {...props}>
      {children}
    </a>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkRule — THE divider (ALT-283). Two variants, decided 2026-07-01:
     strong — 2px solid ink: page-header rule (absorbs .pv-rule)
     quiet  — 1px var(--rule): internal separations (absorbs .pv-acct__divider
              and TkSectionHead's faint gradient rule)
   The landing page's rust→gold accent tick (.lp-rule) is a marketing-only
   brand accent, NOT a divider — it stays out of the kit on purpose.
   ════════════════════════════════════════════════════════════════════ */
export function TkRule({
  variant = "strong",
  className,
  ...props
}: {
  variant?: "strong" | "quiet"
} & HTMLAttributes<HTMLHRElement>) {
  return <hr className={cx(`tk-rule-${variant}`, className)} {...props} />
}

/* ════════════════════════════════════════════════════════════════════
   TkChip
   ════════════════════════════════════════════════════════════════════ */
export function TkChip({
  family,
  className,
  children,
  ...props
}: {
  family: TkFamily
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx("tk-chip", `tk-chip-${family}`, className)} {...props}>
      {children}
    </span>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkConfidence — the ONE product-wide confidence encoding: segmented pips.
   high = 3 teal filled · medium = 2 gold + 1 empty · directional = 1 + dashed.
   ════════════════════════════════════════════════════════════════════ */
export type TkConfidenceLevel = "high" | "medium" | "directional"

const CONF_LABEL: Record<TkConfidenceLevel, string> = {
  high: "High",
  medium: "Medium",
  directional: "Directional",
}
// number of "on" pips per level (total is always 3)
const CONF_ON: Record<TkConfidenceLevel, number> = {
  high: 3,
  medium: 2,
  directional: 1,
}

export function TkConfidence({
  level,
  label,
  showLabel = true,
  className,
  ...props
}: {
  level: TkConfidenceLevel
  /** override the default label text ("High" / "Medium" / "Directional") */
  label?: string
  showLabel?: boolean
} & HTMLAttributes<HTMLSpanElement>) {
  const on = CONF_ON[level]
  return (
    <span
      className={cx("tk-conf-pips", `tk-conf-${level}`, className)}
      role="img"
      aria-label={`${label ?? CONF_LABEL[level]} confidence`}
      {...props}
    >
      <span className="tk-pips" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cx("tk-pip", i < on ? "tk-pip-on" : "tk-pip-off")}
          />
        ))}
      </span>
      {showLabel && (
        <span className="tk-conf-label">{label ?? CONF_LABEL[level]}</span>
      )}
    </span>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkWinFlag
   ════════════════════════════════════════════════════════════════════ */
export function TkWinFlag({
  children = "You're winning",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx("tk-win-flag", className)} {...props}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 9h12l-1.5 9h-9z" />
        <path d="M9 9V6a3 3 0 0 1 6 0v3" />
      </svg>
      {children}
    </span>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkCard / TkSoftPanel
   ════════════════════════════════════════════════════════════════════ */
export function TkCard({
  tBubble,
  className,
  children,
  ...props
}: {
  /** ALT-230 — optional "Ask Ticket about this" T-bubble (a <VizTBubble/> client node).
   *  It absolute-positions itself in the card corner; passing it stays server-safe. */
  tBubble?: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("tk-card", className)} {...props}>
      {tBubble}
      {children}
    </div>
  )
}

export function TkSoftPanel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("tk-soft-panel", className)} {...props}>
      {children}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkSectionHead — h3 + sub + gradient hairline rule
   ════════════════════════════════════════════════════════════════════ */
export function TkSectionHead({
  title,
  sub,
  id,
  className,
  ...props
}: {
  title: ReactNode
  sub?: ReactNode
  id?: string
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
  return (
    <div id={id} className={cx("tk-sec-head", className)} {...props}>
      <h3>{title}</h3>
      {sub != null && <span className="tk-sub">{sub}</span>}
      <span className="tk-rule" aria-hidden="true" />
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkPhotoFallback — the ONE clean, neutral placeholder for an image slot
   that has no real photo (ALT-152). Replaces the old abstract rust/gold
   gradient blob. A calm muted panel with a small image glyph and, when a
   label is given, the subject's initial — never a fabricated graphic.
   Server-safe (presentational only); reads in light + dark via tokens.
   ════════════════════════════════════════════════════════════════════ */
export function TkPhotoFallback({
  label,
  className,
  ...props
}: {
  /** subject (e.g. a handle / venue name). Its first letter shows as a quiet monogram. */
  label?: string
} & HTMLAttributes<HTMLDivElement>) {
  const initial = label?.trim()?.replace(/^@/, "")?.[0]?.toUpperCase() ?? null
  return (
    <div
      className={cx("tk-photo tk-photo-empty", className)}
      role="img"
      aria-label={label ? `No image for ${label}` : "No image available"}
      {...props}
    >
      <span className="tk-photo-mark" aria-hidden="true">
        {initial ?? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <circle cx="8.5" cy="9.5" r="1.6" />
            <path d="M21 16l-5-5L7 20" />
          </svg>
        )}
      </span>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkViz caption — shared little header used above each viz
   ════════════════════════════════════════════════════════════════════ */
export function TkVizCap({
  left,
  right,
}: {
  left: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="tk-viz-cap">
      <span className="tk-l">{left}</span>
      {right != null && <span className="tk-r">{right}</span>}
    </div>
  )
}

export { cx as tkcx }
