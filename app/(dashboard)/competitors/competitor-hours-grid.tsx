"use client"

// ALT-231 — "Who's open when": a 24-hour OPEN-HOURS bar per competitor, with the
// busy curve painted INSIDE the open window (quiet → busy, same gold ramp as the
// weekly heatmap above), navigable ONE DAY AT A TIME (default = today) via a day
// selector + prev/next. Each row can expand into its own 7-day breakdown (the
// "accordion" from the 2026-06-29 review) so we never render 7 days × every spot
// at once.
//
// Design language is Concept A's window track: closed hours read as a muted
// diagonal hatch, open hours as filled cells. Honest framing: open hours + busy
// curves are Google Maps data; a spot with no readable hours shows an explicit
// "hours unavailable" track — we never invent a window. Pure data-viz, so the card
// carries the "Ask Ticket about this" T-bubble (ALT-230) to turn the picture into
// an insight.
//
// ALT-264 — belt-and-suspenders fallback: when a spot's POSTED hours can't be read
// but its busy curve exists, we still paint the busy read — on an "observed
// activity" window (dashed band edges, labeled as observed) derived from the hours
// Google saw activity. The widget only goes to its empty state when there's
// neither hours NOR activity for the whole set.

import { useEffect, useMemo, useState } from "react"
import { RevealOnView, TkCard, TkSectionHead, TkEmptyState } from "@/components/ticket"
import { VizTBubble, type VizContext } from "@/components/ticket/viz-tbubble"
import { tkcx as cx } from "@/components/ticket/primitives"
import {
  isOpenAtHour,
  openLabel,
  openHourCount,
  observedWindow,
  observedLabel,
  type DayHours,
} from "@/lib/competitors/open-hours"

/** One day's open window (parsed server-side) + that day's busy curve. Serializable. */
export type HoursDay = {
  day_of_week: number
  /** parsed open window for the day (known/open/is24h/intervals) */
  hours: DayHours
  /** 24-element busy curve (0–100, % of own typical peak) or null when not pulled */
  hourly_scores: number[] | null
}

/** One entity (own location or a competitor) for the open-hours grid. */
export type HoursEntity = {
  competitor_id: string
  name: string
  isYou: boolean
  days: HoursDay[]
  /** true when at least one day had readable open hours (else the row is "unavailable") */
  hoursKnown: boolean
}

const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const HOURS = Array.from({ length: 24 }, (_, i) => i) // 0..23 — full day (breakfast → late night)
const AXIS = [0, 6, 12, 18, 24] // tick hours under the track

const CLOCK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

/** Busy intensity → background. DESIGN DECISION (ALT-231): the 2026-06-29 review
 *  referenced the old traffic visual's "white to dark red" ramp, but we deliberately
 *  use the GOLD ramp here to match the weekly "When the block fills up" heatmap that
 *  sits directly above this widget on the same page — the two busy reads then share
 *  one visual language, and gold reads as "activity" rather than red's "alert/danger".
 *  Same mix math as traffic-heatmap-grid's heatStyle. */
function busyBg(score: number): string {
  const t = Math.min(1, Math.max(0, score) / 100)
  const pct = Math.round(18 + t * 70) // 18%→88% gold mix
  return `color-mix(in srgb, var(--gold) ${pct}%, var(--card))`
}

function hourTick(h: number): string {
  const hh = h % 24
  if (hh === 0) return "12a"
  if (hh === 12) return "12p"
  return hh < 12 ? `${hh}a` : `${hh - 12}p`
}

const pct = (n: number): string => `${(n / 24) * 100}%`

/** One 24-hour track for an entity on one day. The track BACKGROUND is a seamless
 *  diagonal "closed" hatch (Concept A); open windows paint as a calm tint band on
 *  top, and the busy curve paints per-hour heat cells over the band (quiet → busy).
 *  Open-but-not-pulled hours stay the calm tint — honest, never a fabricated peak. */
function HoursTrack({
  day,
  scores,
  compact = false,
}: {
  day: DayHours
  scores: number[] | null
  compact?: boolean
}) {
  // ALT-264 — posted hours unreadable but Google observed activity ⇒ render the
  // busy curve on an OBSERVED window (dashed band) instead of a dead flat track.
  const { eff, observed } = useMemo(() => {
    const obs = !day.known ? observedWindow(scores) : null
    return {
      observed: obs != null,
      eff: obs
        ? ({ known: true, open: true, is24h: false, intervals: [obs] } as DayHours)
        : day,
    }
  }, [day, scores])

  // Busiest OPEN hour (with data) → a subtle peak cap, echoing Concept A's "surge".
  const peakHour = useMemo(() => {
    if (!eff.open || !scores) return -1
    let best = -1
    let bestScore = -1
    for (const h of HOURS) {
      if (isOpenAtHour(eff, h) && scores[h] != null && scores[h] > bestScore) {
        bestScore = scores[h]
        best = h
      }
    }
    return bestScore >= 12 ? best : -1 // ignore flat curves — no false "peak"
  }, [eff, scores])

  if (!eff.known) {
    return (
      <div className={cx("tk-hrs-track", "tk-hrs-flat", compact && "tk-hrs-track-sm")}>
        <span className="tk-hrs-flat-lbl">Hours unavailable</span>
      </div>
    )
  }
  if (!eff.open) {
    return (
      <div className={cx("tk-hrs-track", compact && "tk-hrs-track-sm")} role="img" aria-label="Closed">
        {!compact && <span className="tk-hrs-flat-lbl tk-hrs-closed-lbl">Closed</span>}
      </div>
    )
  }

  // Screen readers can't see the gold busy ramp, so fold the busy story into the
  // track's label (a text alternative for the color-encoded data — WCAG 1.4.1/1.3.1).
  const windowTxt = observed
    ? `${observedLabel(eff.intervals[0])} (posted hours unavailable)`
    : openLabel(eff)
  const srLabel =
    peakHour >= 0 && scores
      ? `${windowTxt}. Busiest around ${hourTick(peakHour)}, ${scores[peakHour]}% of its typical peak`
      : windowTxt

  return (
    <div className={cx("tk-hrs-track", compact && "tk-hrs-track-sm")} role="img" aria-label={srLabel}>
      {eff.intervals.map((iv, i) => (
        <div
          key={`band-${i}`}
          className={cx("tk-hrs-band", observed && "tk-hrs-band-obs")}
          style={{ left: pct(iv.start), width: pct(iv.end - iv.start) }}
        />
      ))}
      {scores &&
        HOURS.map((h) => {
          if (!isOpenAtHour(eff, h)) return null
          const s = scores[h]
          if (s == null) return null
          return (
            <div
              key={`heat-${h}`}
              className={cx("tk-hrs-heat", h === peakHour && "tk-hrs-peak")}
              style={{ left: pct(h), width: pct(1), background: busyBg(s) }}
              data-tip={`${hourTick(h)} to ${hourTick(h + 1)} · ${s}% of own typical peak`}
            />
          )
        })}
    </div>
  )
}

export default function CompetitorHoursGrid({
  entities,
  todayDow,
  locationId,
}: {
  entities: HoursEntity[]
  /** day-of-week to open on (0=Sun); the page passes "today" so we center on it */
  todayDow: number
  locationId?: string
}) {
  const serverToday = ((todayDow % 7) + 7) % 7
  const [day, setDay] = useState(serverToday)
  const [today, setToday] = useState(serverToday)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  // `todayDow` is computed server-side (UTC on Vercel), which can be a day off from the
  // operator's local weekday. Correct to the client's real local day on mount — deferred
  // via rAF so there's no synchronous setState in the effect body (react-hooks rule), and
  // no SSR/hydration mismatch (server + first client render both use the prop). Only move
  // the selected day if the operator hasn't already picked one.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const local = new Date().getDay()
      setToday(local)
      setDay((d) => (d === serverToday ? local : d))
    })
    return () => cancelAnimationFrame(id)
  }, [serverToday])

  // Empty state only when the whole set has neither readable hours NOR any
  // observed activity (ALT-264) — a busy-only row still renders its curve.
  const anyData = entities.some(
    (e) =>
      e.hoursKnown ||
      e.days.some((d) => Array.isArray(d.hourly_scores) && d.hourly_scores.some((s) => s > 0)),
  )
  if (entities.length === 0 || !anyData) {
    return (
      <>
        <TkSectionHead title="Who's open when" sub="Open hours across the block, by day" />
        <TkEmptyState
          icon={CLOCK_ICON}
          variant="muted"
          title="No opening hours read yet"
          description="We read each spot's open hours from Google Maps. Once a listing is pulled, you'll see when every competitor is open across the day, and how busy they run while they're open."
        />
      </>
    )
  }

  const dayLabel = DAY_FULL[day]
  const byDay = (e: HoursEntity, d: number): HoursDay | undefined =>
    e.days.find((x) => x.day_of_week === d)

  const viz: VizContext = {
    domain: "competitors",
    metric: "Who's open when",
    entityType: "competitor",
    timeframe: dayLabel,
    source: "Google Maps",
    locationId,
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function step(delta: number) {
    setDay((d) => (((d + delta) % 7) + 7) % 7)
  }

  return (
    <>
      <TkSectionHead title="Who's open when" sub="Open hours and how busy each spot runs, by day" />
      <RevealOnView>
        <TkCard tBubble={<VizTBubble viz={viz} />}>
          <div className="tk-hrs">
            {/* ── Day controller: prev/next + a 7-day selector, centered on today ── */}
            <div className="tk-hrs-bar">
              {/* A button group, not a tablist: each day is an independently
                  Tab-focusable button whose selected state is aria-pressed, and the
                  prev/next buttons step the day. (role=tab would promise arrow-key /
                  roving-tabindex behavior we don't implement — WCAG 4.1.2.) */}
              <div className="tk-hrs-days" role="group" aria-label="Choose a day">
                <button
                  type="button"
                  className="tk-hrs-step"
                  onClick={() => step(-1)}
                  aria-label="Previous day"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                {DAY_ABBR.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={i === day}
                    aria-label={`${DAY_FULL[i]}${i === today ? " (today)" : ""}`}
                    className={cx("tk-hrs-day", i === day && "tk-hrs-day-on", i === today && "tk-hrs-day-today")}
                    onClick={() => setDay(i)}
                  >
                    {d}
                    {i === today && <span className="tk-hrs-today-dot" aria-hidden="true" />}
                  </button>
                ))}
                <button
                  type="button"
                  className="tk-hrs-step"
                  onClick={() => step(1)}
                  aria-label="Next day"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              </div>
              <span className="tk-hrs-legend" aria-hidden="true">
                <span className="tk-hrs-leg-ramp"><i /><i /><i /><i /></span>
                <span>quiet → busy</span>
                <span className="tk-hrs-leg-x"><span className="tk-hrs-leg-closed" /> closed</span>
                <span className="tk-hrs-leg-x"><span className="tk-hrs-leg-obs" /> observed</span>
              </span>
            </div>

            {/* ── One row per entity for the selected day ── */}
            <div className="tk-hrs-rows">
              {entities.map((e) => {
                const dh = byDay(e, day)
                const hours: DayHours = dh?.hours ?? { known: false, open: false, is24h: false, intervals: [] }
                // ALT-264 — no posted hours but activity exists: label the row with the
                // observed window so the head matches the dashed track below it.
                const obs = !hours.known ? observedWindow(dh?.hourly_scores ?? null) : null
                const isOpenExpanded = expanded.has(e.competitor_id)
                return (
                  <div key={e.competitor_id} className={cx("tk-hrs-row", e.isYou && "tk-hrs-row-you")}>
                    <div className="tk-hrs-rowhead">
                      <button
                        type="button"
                        className={cx("tk-hrs-expand", isOpenExpanded && "tk-hrs-expand-on")}
                        onClick={() => toggle(e.competitor_id)}
                        aria-expanded={isOpenExpanded}
                        aria-controls={`tk-hrs-week-${e.competitor_id}`}
                        aria-label={`${isOpenExpanded ? "Hide" : "Show"} ${e.name}'s full week`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                      </button>
                      <span className="tk-hrs-name">
                        {e.name}
                        {e.isYou && <span className="tk-hrs-you">You</span>}
                      </span>
                      <span
                        className="tk-hrs-open-lbl"
                        title={obs ? "Posted hours unavailable — showing when Google observed activity" : undefined}
                      >
                        {obs ? observedLabel(obs) : openLabel(hours)}
                      </span>
                    </div>
                    <HoursTrack day={hours} scores={dh?.hourly_scores ?? null} />

                    {/* Accordion: this spot's full week, broken down by day */}
                    {isOpenExpanded && (
                      <div
                        className="tk-hrs-week"
                        id={`tk-hrs-week-${e.competitor_id}`}
                        role="group"
                        aria-label={`${e.name} — open hours by day`}
                      >
                        {DAY_ABBR.map((lbl, d) => {
                          const wd = byDay(e, d)
                          const wh: DayHours = wd?.hours ?? { known: false, open: false, is24h: false, intervals: [] }
                          const wObs = !wh.known ? observedWindow(wd?.hourly_scores ?? null) : null
                          return (
                            <div key={d} className={cx("tk-hrs-wrow", d === day && "tk-hrs-wrow-on")}>
                              <span className="tk-hrs-wlbl">{lbl}</span>
                              <HoursTrack day={wh} scores={wd?.hourly_scores ?? null} compact />
                              <span className="tk-hrs-wval">
                                {wh.is24h ? "24h" : wh.known ? `${openHourCount(wh)}h` : wObs ? `~${wObs.end - wObs.start}h` : "?"}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* ── Axis ── */}
            <div className="tk-hrs-axis" aria-hidden="true">
              {AXIS.map((h) => (
                <span key={h}>{hourTick(h)}</span>
              ))}
            </div>

            <p className="tk-hrs-foot">
              Open hours and busy curves come from Google Maps popular times. Busy is shown as a share of each
              spot&apos;s own typical peak: a relative read of timing, not headcount or sales. When a spot posts no
              hours, the dashed window shows where Google observed activity — marked as observed, never presented
              as posted hours.
            </p>
          </div>
        </TkCard>
      </RevealOnView>
    </>
  )
}
