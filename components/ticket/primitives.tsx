// Presentational, server-safe primitives for The Pass kit.
// No hooks / no handlers here (except via passthrough props) so these can render
// in server components. Interactive islands live in their own files.

import type { ButtonHTMLAttributes, ReactNode, HTMLAttributes } from "react"

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ")
}

/* ── families (shared union used across chips / icons) ───────────────── */
export type TkFamily =
  | "competitive"
  | "reputation"
  | "social"
  | "menu"
  | "grassroots"

/* ════════════════════════════════════════════════════════════════════
   TkButton
   ════════════════════════════════════════════════════════════════════ */
export type TkButtonVariant = "act" | "keep" | "dismiss" | "add" | "ghost"

export function TkButton({
  variant = "act",
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
        `tk-btn-${variant}`,
        variant === "keep" && kept && "tk-is-kept",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
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
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("tk-card", className)} {...props}>
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
