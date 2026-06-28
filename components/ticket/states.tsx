// First-run / empty / "still learning" states. Presentational + server-safe.
// (The .tk-sweep shimmer is pure CSS and self-disables under reduced-motion.)

import type { ReactNode } from "react"
import { tkcx as cx } from "./primitives"

/* ════════════════════════════════════════════════════════════════════
   TkEmptyState — generic "nothing here yet" with optional icon + action.
   ════════════════════════════════════════════════════════════════════ */
export function TkEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx("tk-empty", className)}>
      {icon && <div className="tk-empty-ic" aria-hidden="true">{icon}</div>}
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkStillLearning — "still reading your block — N days in" state.
   Renders the ring-progress glyph (days/target) + the .tk-sweep shimmer
   to signal the system is actively working.
   ════════════════════════════════════════════════════════════════════ */
export function TkStillLearning({
  days,
  target = 30,
  title,
  description,
  className,
}: {
  /** how many days of history collected so far */
  days: number
  /** the day count at which the feature unlocks (drives the ring) */
  target?: number
  title?: ReactNode
  description?: ReactNode
  className?: string
}) {
  const R = 19
  const CIRC = 2 * Math.PI * R // ≈ 119
  const pct = Math.max(0, Math.min(1, days / target))
  const offset = CIRC * (1 - pct)

  return (
    <div className={cx("tk-learning", "tk-sweep", className)}>
      <svg className="tk-lring" viewBox="0 0 46 46" aria-hidden="true">
        <circle cx="23" cy="23" r={R} fill="none" stroke="var(--line-2)" strokeWidth="4" />
        <circle
          cx="23"
          cy="23"
          r={R}
          fill="none"
          stroke="var(--rust)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRC.toFixed(0)}
          strokeDashoffset={offset.toFixed(0)}
          transform="rotate(-90 23 23)"
        />
        <text
          x="23"
          y="27"
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize="11"
          fontWeight="700"
          fill="var(--ink)"
        >
          {days}
        </text>
      </svg>
      <div className="tk-lt">
        <h5>{title ?? `Unlocks at ${target} days`}</h5>
        <p>
          {description ?? (
            <>
              Still reading your area — <b>{days} days in</b>. We&apos;ll show this
              once there&apos;s enough history to be honest about it.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
