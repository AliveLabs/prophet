"use client"

import type { ReactNode } from "react"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { useInView } from "./use-in-view"
import { TkVizCap, tkcx as cx } from "./primitives"

/* ════════════════════════════════════════════════════════════════════
   TkRangeBar — single fill 0→value with a point marker.
   ════════════════════════════════════════════════════════════════════ */
export function TkRangeBar({
  value,
  scale,
  caption,
  captionRight,
  tip,
  tipValue,
}: {
  /** 0–100 fill width */
  value: number
  /** the 3 scale labels under the bar [min, mid, max] */
  scale?: [ReactNode, ReactNode, ReactNode]
  caption?: ReactNode
  captionRight?: ReactNode
  tip?: string
  tipValue?: string
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <div className="tk-viz">
      {caption && <TkVizCap left={caption} right={captionRight} />}
      <div
        className="tk-rangebar"
        ref={ref}
        data-tip={tip}
        data-tipv={tipValue}
      >
        <div className="tk-fill" style={{ width: inView ? `${value}%` : 0 }} />
        <div
          className={cx("tk-pt", inView && "tk-show")}
          style={{ left: `${value}%` }}
        />
      </div>
      {scale && (
        <div className="tk-range-scale">
          <span>{scale[0]}</span>
          <span>{scale[1]}</span>
          <span>{scale[2]}</span>
        </div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkSentimentRows — labeled rows, each a 0→width bar + a percent.
   ════════════════════════════════════════════════════════════════════ */
export type TkSentimentTone = "bad" | "warn" | "ok"

export function TkSentimentRows({
  rows,
  caption,
  captionRight,
}: {
  rows: Array<{
    label: ReactNode
    /** 0–100 bar width */
    width: number
    /** displayed value text, e.g. "38%" */
    value: ReactNode
    tone: TkSentimentTone
    tip?: string
    tipValue?: string
  }>
  caption?: ReactNode
  captionRight?: ReactNode
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <div className="tk-viz">
      {caption && <TkVizCap left={caption} right={captionRight} />}
      <div className="tk-sentcat" ref={ref}>
        {rows.map((r, i) => (
          <div className="tk-scrow" key={i}>
            <span className="tk-cn">{r.label}</span>
            <div className="tk-sctrack" data-tip={r.tip} data-tipv={r.tipValue}>
              <i
                className={cx("tk-scf", `tk-${r.tone}`)}
                style={{ width: inView ? `${r.width}%` : 0 }}
              />
            </div>
            <span className={cx("tk-pv", `tk-pv-${r.tone}`)}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkNumBig — big count-up number (reuses AnimatedNumber) + arrow tag + sub.
   ════════════════════════════════════════════════════════════════════ */
export function TkNumBig({
  value,
  suffix = "",
  prefix = "",
  format,
  trend,
  trendLabel,
  unit,
  sub,
  caption,
  captionRight,
  tip,
  tipValue,
}: {
  value: number
  suffix?: string
  prefix?: string
  format?: (n: number) => string
  /** show an up/down arrow pill */
  trend?: "up" | "down"
  trendLabel?: ReactNode
  unit?: ReactNode
  sub?: ReactNode
  caption?: ReactNode
  captionRight?: ReactNode
  tip?: string
  tipValue?: string
}) {
  return (
    <div className="tk-viz">
      {caption && <TkVizCap left={caption} right={captionRight} />}
      <div className="tk-numbig">
        <AnimatedNumber
          className="tk-big"
          value={value}
          prefix={prefix}
          suffix={suffix}
          format={format}
        />
        {trend && (
          <span
            className={cx("tk-arrowtag", `tk-${trend}`)}
            data-tip={tip}
            data-tipv={tipValue}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              {trend === "up" ? (
                <path d="M5 19L19 5M19 5h-9M19 5v9" />
              ) : (
                <path d="M5 5l14 14M19 19h-9M19 19v-9" />
              )}
            </svg>
            {trendLabel ?? (trend === "up" ? "Up" : "Down")}
          </span>
        )}
        {unit && <span className="tk-unit">{unit}</span>}
      </div>
      {sub && <div className="tk-numsub">{sub}</div>}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkH2HBars — head-to-head bars that grow from a center line.
   Each side's width is capped at 50% of the track (matches Concept A's
   `w * 0.5`), so pass the raw 0–100 magnitude.
   ════════════════════════════════════════════════════════════════════ */
export function TkH2HBars({
  title,
  rows,
  note,
}: {
  title?: ReactNode
  rows: Array<{
    metric: ReactNode
    /** which side leads */
    side: "you" | "them"
    /** 0–100 magnitude (rendered at half-width from the center) */
    width: number
    verdict: ReactNode
    tip?: string
    tipValue?: string
  }>
  note?: ReactNode
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <div className="tk-h2h" ref={ref}>
      {title && (
        <div className="tk-h2h-title">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4M15 21h4a2 2 0 0 0 2-2v-4" />
          </svg>
          {title}
        </div>
      )}
      <div className="tk-h2h-legend">
        <span><i style={{ background: "var(--teal)" }} /> You&apos;re ahead</span>
        <span><i style={{ background: "var(--alert)" }} /> They&apos;re ahead</span>
        <span className="tk-muted">Bars grow from the center line.</span>
      </div>
      {rows.map((r, i) => (
        <div className="tk-h2h-row" key={i}>
          <span className="tk-metric">{r.metric}</span>
          <div className="tk-h2h-bar">
            <span className="tk-center" />
            <span
              className={r.side === "you" ? "tk-you" : "tk-them"}
              data-tip={r.tip}
              data-tipv={r.tipValue}
              style={{ width: inView ? `${r.width * 0.5}%` : 0 }}
            />
          </div>
          <span className={cx("tk-verdict", r.side === "you" ? "tk-win" : "tk-lose")}>
            {r.verdict}
          </span>
        </div>
      ))}
      {note && <p style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 6 }}>{note}</p>}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkWindowViz — the "open window" timeline strip (you-open / surge /
   competitor-close segments). Segments are positioned by percent.
   ════════════════════════════════════════════════════════════════════ */
export function TkWindowViz({
  headLabel,
  headValue,
  axisLabels,
  segments,
  legend,
}: {
  headLabel: ReactNode
  headValue: ReactNode
  /** the 4 axis ticks below the track */
  axisLabels: ReactNode[]
  segments: Array<{
    kind: "you-open" | "surge" | "comp-close"
    /** css left/right/width as percent strings, e.g. { left: "62%", width: "22%" } */
    left?: string
    right?: string
    width?: string
    tip?: string
    tipValue?: string
  }>
  legend?: ReactNode
}) {
  return (
    <div className="tk-window-viz">
      <div className="tk-wv-head">
        <span className="tk-lbl">{headLabel}</span>
        <span className="tk-val">{headValue}</span>
      </div>
      <div className="tk-wtrack">
        {segments.map((s, i) => (
          <div
            key={i}
            className={`tk-${s.kind}`}
            data-tip={s.tip}
            data-tipv={s.tipValue}
            style={{ left: s.left, right: s.right, width: s.width }}
          />
        ))}
      </div>
      <div className="tk-wtrack-labels">
        {axisLabels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
      {legend && <div className="tk-wleg">{legend}</div>}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkWeatherStrip — horizontal 7-day forecast + demand chips.
   ════════════════════════════════════════════════════════════════════ */
export type TkWeatherIcon = "sun" | "cloud" | "rain" | "storm"
export type TkDemand = "up" | "flat" | "down"

const WEATHER_GLYPH: Record<TkWeatherIcon, ReactNode> = {
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
    </svg>
  ),
  cloud: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17 18a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3.5 3.5 0 0 0 6 18z" />
    </svg>
  ),
  rain: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17 14a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3.5 3.5 0 0 0 6 14z" />
      <path d="M8 18v2M12 18v3M16 18v2" />
    </svg>
  ),
  storm: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17 16a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3.5 3.5 0 0 0 6 16z" />
      <path d="M11 14l-2 4h3l-2 4" />
    </svg>
  ),
}

const DEMAND_LABEL: Record<TkDemand, string> = { up: "Up", flat: "Flat", down: "Down" }

export function TkWeatherStrip({
  days,
  caption,
  captionRight,
}: {
  days: Array<{
    dow: ReactNode
    icon: TkWeatherIcon
    hi: ReactNode
    lo: ReactNode
    demand: TkDemand
    event?: ReactNode
    tip?: string
    tipValue?: string
  }>
  caption?: ReactNode
  captionRight?: ReactNode
}) {
  return (
    <div className="tk-viz">
      {caption && <TkVizCap left={caption} right={captionRight} />}
      <div className="tk-fc7">
        {days.map((d, i) => (
          <div className="tk-fcday" key={i}>
            {d.event && <div className="tk-evt">{d.event}</div>}
            <div className="tk-dow">{d.dow}</div>
            <div className={cx("tk-ic", `tk-${d.icon}-ic`)}>{WEATHER_GLYPH[d.icon]}</div>
            <div className="tk-hi">{d.hi}</div>
            <div className="tk-lo">{d.lo}</div>
            <div className={cx("tk-dem", `tk-${d.demand}`)} data-tip={d.tip} data-tipv={d.tipValue}>
              {DEMAND_LABEL[d.demand]}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkSocialEmbed — a competitor post card with engagement stats.
   ════════════════════════════════════════════════════════════════════ */
export function TkSocialEmbed({
  handle,
  verified = false,
  subline,
  network,
  caption,
  tags,
  stats,
  photo,
  photoLabel,
}: {
  handle: ReactNode
  verified?: boolean
  subline?: ReactNode
  /** the network pill (icon + name) */
  network?: ReactNode
  caption?: ReactNode
  tags?: ReactNode
  stats?: Array<{ value: ReactNode; label: ReactNode; highlight?: boolean; tip?: string; tipValue?: string }>
  photo?: ReactNode
  photoLabel?: string
}) {
  return (
    <div className="tk-social-embed">
      <div className="tk-se-head">
        <span className="tk-se-avatar"><i /></span>
        <div className="tk-se-meta">
          <div className="tk-h">
            {handle}
            {verified && (
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2l2.4 2.1 3.1-.5 1 3 2.8 1.5-1 3 1 3-2.8 1.5-1 3-3.1-.5L12 22l-2.4-2.1-3.1.5-1-3L2.7 16l1-3-1-3 2.8-1.5 1-3 3.1.5z" />
              </svg>
            )}
          </div>
          {subline && <div className="tk-s">{subline}</div>}
        </div>
        {network && <span className="tk-se-net">{network}</span>}
      </div>
      <div className="tk-se-photo">
        {photo ?? <div className="tk-photo" data-label={photoLabel} />}
      </div>
      <div className="tk-se-actions" aria-hidden="true">
        <svg className="tk-heart" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7-4.5-9.5-9C.9 8.6 2.5 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.5 0 5.1 3.6 3.5 7-2.5 4.5-9.5 9-9.5 9z" /></svg>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5z" /></svg>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>
      </div>
      {caption && (
        <div className="tk-se-caption">
          {caption} {tags && <span className="tk-tag">{tags}</span>}
        </div>
      )}
      {stats && stats.length > 0 && (
        <div className="tk-se-stats">
          {stats.map((s, i) => (
            <div className="tk-se-stat" key={i} data-tip={s.tip} data-tipv={s.tipValue}>
              <span className={cx("tk-v", s.highlight && "tk-hi")}>{s.value}</span>
              <span className="tk-k">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   TkQuote — a single review quote with stars + meta.
   ════════════════════════════════════════════════════════════════════ */
export function TkQuote({
  text,
  who,
  stars,
  when,
}: {
  text: ReactNode
  who?: ReactNode
  /** 0–5 star rating; renders ★/☆ */
  stars?: number
  when?: ReactNode
}) {
  return (
    <div className="tk-quote">
      <p>{text}</p>
      {(who || stars != null || when) && (
        <div className="tk-qmeta">
          {who && <span className="tk-who">{who}</span>}
          {stars != null && (
            <span className="tk-stars" aria-label={`${stars} out of 5 stars`}>
              {"★".repeat(Math.max(0, Math.min(5, stars)))}
              {"☆".repeat(Math.max(0, 5 - Math.max(0, Math.min(5, stars))))}
            </span>
          )}
          {when && <span>· {when}</span>}
        </div>
      )}
    </div>
  )
}
