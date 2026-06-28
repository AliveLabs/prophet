// Larger presentational blocks: Hero, PlayCard, WidgetGrid + Widget, Actions row.
// Server-safe (no hooks); interactivity is injected via `actions`/`children`.

import type { ReactNode, HTMLAttributes } from "react"
import { tkcx as cx, type TkFamily } from "./primitives"

/* ════════════════════════════════════════════════════════════════════
   TkActions — the button row at the foot of a play
   ════════════════════════════════════════════════════════════════════ */
export function TkActions({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("tk-actions", className)} {...props}>
      {children}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkHero — 2-col photo/gradient-canvas (left) + body (right).
   Stacks photo-FIRST at ≤980 (handled in pass.css via order:-1).
   ════════════════════════════════════════════════════════════════════ */
export function TkHero({
  // body
  chips,
  title,
  titleId,
  lede,
  children,
  actions,
  // photo canvas
  photo,
  photoLabel,
  venueChip,
  className,
  ...props
}: {
  chips?: ReactNode
  title: ReactNode
  titleId?: string
  lede?: ReactNode
  /** viz / window-strip / why-rolldown go here, between lede and actions */
  children?: ReactNode
  actions?: ReactNode
  /** custom photo content; if omitted a gradient canvas is rendered */
  photo?: ReactNode
  photoLabel?: string
  venueChip?: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <article
      className={cx("tk-hero", className)}
      aria-labelledby={titleId}
      {...props}
    >
      <div className="tk-hero-grid">
        <div className="tk-hero-body">
          {chips && <div className="tk-hero-toprow">{chips}</div>}
          <h2 id={titleId}>{title}</h2>
          {lede && <p className="tk-lede">{lede}</p>}
          {children}
          {actions && <TkActions>{actions}</TkActions>}
        </div>

        <div className="tk-hero-photo">
          {venueChip && <span className="tk-hero-venuechip">{venueChip}</span>}
          {photo ?? (
            <div className="tk-photo" data-label={photoLabel}>
              <div className="tk-veil" />
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkPlayCard — the ranked-play card in the grid.
   ════════════════════════════════════════════════════════════════════ */
export function TkPlayCard({
  family,
  icon,
  title,
  summary,
  chips,
  confidence,
  children,
  actions,
  onTitleClick,
  className,
  ...props
}: {
  family: TkFamily
  /** the small square icon glyph (an <svg/>) */
  icon: ReactNode
  title: ReactNode
  summary?: ReactNode
  /** chip row content (e.g. <TkChip/> + distance pill) */
  chips?: ReactNode
  /** top-right status (e.g. <TkConfidence/> or <TkWinFlag/>) */
  confidence?: ReactNode
  /** viz + why rolldown go here */
  children?: ReactNode
  actions?: ReactNode
  onTitleClick?: () => void
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <article className={cx("tk-pcard", className)} {...props}>
      <div className="tk-pc-top">
        <div className={cx("tk-pc-icon", `tk-icon-${family}`)} aria-hidden="true">
          {icon}
        </div>
        {confidence}
      </div>
      {chips && <div className="tk-pc-chiprow">{chips}</div>}
      <h4 onClick={onTitleClick}>{title}</h4>
      {summary && <p className="tk-pc-sum">{summary}</p>}
      {children}
      {actions && <TkActions>{actions}</TkActions>}
    </article>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkWidgetGrid + TkWidget
   ════════════════════════════════════════════════════════════════════ */
export function TkWidgetGrid({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("tk-widgets", className)} {...props}>
      {children}
    </div>
  )
}

export type TkWidgetTone = "rust" | "teal" | "gold" | "slate"
export type TkWidgetSize = "default" | "wide" | "tall"

export function TkWidget({
  tone,
  size = "default",
  label,
  value,
  sub,
  spark,
  children,
  className,
  ...props
}: {
  tone: TkWidgetTone
  size?: TkWidgetSize
  label: ReactNode
  /** main value (omit when supplying a custom body via children) */
  value?: ReactNode
  sub?: ReactNode
  /** optional sparkline <svg/> pinned bottom-right */
  spark?: ReactNode
  /** custom body (e.g. the reputation-pulse rows in a tall slate tile) */
  children?: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "tk-widget",
        `tk-w-${tone}`,
        size === "wide" && "tk-w-wide",
        size === "tall" && "tk-w-tall",
        className
      )}
      {...props}
    >
      <span className="tk-wlbl">{label}</span>
      {children ? (
        <div className="tk-wbody">{children}</div>
      ) : (
        <div>
          {value != null && <div className="tk-wval">{value}</div>}
          {sub != null && <div className="tk-wsub">{sub}</div>}
        </div>
      )}
      {spark && <span className="tk-spark" aria-hidden="true">{spark}</span>}
    </div>
  )
}

/* a single row inside a tall widget (e.g. reputation pulse) */
export function TkWidgetRow({
  name,
  value,
  thumb = true,
  valueColor,
}: {
  name: ReactNode
  value: ReactNode
  thumb?: boolean
  valueColor?: string
}) {
  return (
    <div className="tk-wrow">
      <span className="tk-nm">
        {thumb && <span className="tk-thumb" />}
        {name}
      </span>
      <span className="tk-pos" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  )
}
