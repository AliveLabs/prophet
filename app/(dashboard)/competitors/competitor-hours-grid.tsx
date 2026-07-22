"use client"

// "Who's busy when" (ALT-262/263/265 rebuild of ALT-231's "Who's open when") — one
// composite rhythm read for the whole set: a 24-hour track per spot showing WHEN
// it's open and the SHAPE of its day (an area curve of Google popular times),
// navigable one day at a time, with a per-spot week profile and a generated
// plain-language read line.
//
// THE HONESTY RULE THAT SHAPES THIS WIDGET: Google's busy score is "% of that
// spot's OWN typical peak" — a self-normalized number with no headcount in it.
// Research (2026-07-01, Reddit/GBP operator sweep) showed people read a bare
// percentage as occupancy, so the surface NEVER shows the raw % — it speaks in
// four plain levels (Quiet / Steady / Busy / Their peak), the same categorical
// language Google Maps itself uses. The truly comparable numbers stay numeric:
// peak TIME, open hours, day-of-week profile. Cross-spot magnitude comparison
// ("who's busier") deliberately does not exist here — that question is answered
// honestly by the scorecard's absolute metrics, not by popular times.
//
// ALT-264 fallback preserved: a spot with unreadable posted hours but observed
// activity paints its curve on a dashed "observed" window, labeled as such.

import { useEffect, useId, useMemo, useState } from "react"
import { busyLevel, BUSY_LEVEL_LABEL as LEVEL_LABEL } from "@/lib/traffic/busy-level"
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

/** One entity (own location or a competitor) for the rhythm grid. */
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
const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"]
const HOURS = Array.from({ length: 24 }, (_, i) => i) // 0..23 — full day
const AXIS = [0, 6, 12, 18, 24] // tick hours under the tracks

const CLOCK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

/* Busy levels now live in a shared module so Competitors + Traffic (ALT-286) categorize
   identically — imported at the top as busyLevel + LEVEL_LABEL. */

function hourTick(h: number): string {
  const hh = h % 24
  if (hh === 0) return "12a"
  if (hh === 12) return "12p"
  return hh < 12 ? `${hh}a` : `${hh - 12}p`
}

const pctX = (n: number): string => `${(n / 24) * 100}%`

/** Resolve a day's effective window + whether it's observed-only (ALT-264). */
function effectiveDay(day: DayHours, scores: number[] | null): { eff: DayHours; observed: boolean } {
  const obs = !day.known ? observedWindow(scores) : null
  return {
    observed: obs != null,
    eff: obs ? { known: true, open: true, is24h: false, intervals: [obs] } : day,
  }
}

/* ════════════════════════════════════════════════════════════════════
   RhythmTrack — one 24h track: hatch = closed, tint band = open (dashed
   when observed-only), and the busy curve as an area shape INSIDE the
   window. The curve's amplitude carries the story (a spot that runs hot
   all day still shows a visible peak); the rust dot + "7p peak" label
   mark each spot's own busiest hour. The raw % never renders.
   ════════════════════════════════════════════════════════════════════ */
const TRACK_H = 44 // non-compact track height (compact rows keep the 16px CSS class)

function RhythmTrack({
  day,
  scores,
  compact = false,
  scrubHour = null,
}: {
  day: DayHours
  scores: number[] | null
  compact?: boolean
  /** shared hover hour (0-23) — paints the guide + level chip; null = idle */
  scrubHour?: number | null
}) {
  const gid = useId()
  const { eff, observed } = useMemo(() => effectiveDay(day, scores), [day, scores])

  // An hour counts as active when the posted window covers it OR Google recorded
  // activity there — recorded activity always paints (late-night hours matter:
  // insights tell operators to capitalize on 12a-4a, so the curve must show it
  // even when the posted window disagrees).
  const activeAt = (h: number): boolean =>
    isOpenAtHour(eff, h) || ((scores?.[h] ?? 0) > 0)

  // The spot's own busiest hour (needs a real curve — no false peaks on flat data).
  const peakHour = useMemo(() => {
    if (!eff.open || !scores) return -1
    let best = -1
    let bestScore = -1
    for (const h of HOURS) {
      const v = scores[h]
      if ((isOpenAtHour(eff, h) || (v ?? 0) > 0) && v != null && v > bestScore) {
        bestScore = v
        best = h
      }
    }
    return bestScore >= 12 ? best : -1
  }, [eff, scores])

  // Area path over a 100×36 viewBox (preserveAspectRatio=none stretches it to the
  // track). Inactive hours sit on the baseline.
  const H = 36
  const path = useMemo(() => {
    if (!eff.open || !scores) return null
    const y = (v: number) => (v <= 0 ? H : H - 2 - (Math.min(100, v) / 100) * (H - 8))
    const x = (h: number) => ((h + 0.5) / 24) * 100
    let d = `M 0 ${H}`
    for (const h of HOURS) {
      const raw = scores[h] ?? 0
      const v = isOpenAtHour(eff, h) || raw > 0 ? raw : 0
      d += ` L ${x(h).toFixed(2)} ${y(v).toFixed(2)}`
    }
    d += ` L 100 ${H} Z`
    return d
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

  const windowTxt = observed
    ? `${observedLabel(eff.intervals[0])} (posted hours unavailable)`
    : openLabel(eff)
  // The color/shape story, spoken: window + when the spot peaks (WCAG 1.4.1/1.3.1).
  const srLabel =
    peakHour >= 0 ? `${windowTxt}. Busiest around ${hourTick(peakHour)}.` : windowTxt

  const scrubLevel =
    scrubHour != null && scores && activeAt(scrubHour)
      ? busyLevel(scores[scrubHour] ?? 0)
      : null

  return (
    <div
      className={cx("tk-hrs-track", compact && "tk-hrs-track-sm")}
      style={compact ? undefined : { height: TRACK_H }}
      role="img"
      aria-label={srLabel}
    >
      {/* faint hour gridlines (6a/12p/6p) so the axis ticks visibly tie to the plot */}
      {!compact &&
        [6, 12, 18].map((h) => (
          <span key={`grid-${h}`} className="tk-hrs-gridline" style={{ left: pctX(h) }} aria-hidden="true" />
        ))}
      {eff.intervals.map((iv, i) => (
        <div
          key={`band-${i}`}
          className={cx("tk-hrs-band", observed && "tk-hrs-band-obs")}
          style={{ left: pctX(iv.start), width: pctX(iv.end - iv.start) }}
        />
      ))}

      {path && (
        <svg
          className="tk-hrs-curve"
          viewBox={`0 0 100 ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="var(--gold-tint)" />
              <stop offset="1" stopColor="var(--gold)" />
            </linearGradient>
          </defs>
          <path d={path} fill={`url(#${gid})`} stroke="var(--gold-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {peakHour >= 0 && scores && (
            <circle
              cx={((peakHour + 0.5) / 24) * 100}
              cy={H - 2 - (Math.min(100, scores[peakHour] ?? 0) / 100) * (H - 8)}
              r={compact ? 1.6 : 2.2}
              fill="var(--rust)"
              stroke="var(--card)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}

      {/* The honest cross-venue number: WHEN they peak (never a bare %). */}
      {!compact && peakHour >= 0 && (
        <span
          className="tk-hrs-peaklbl"
          style={{ left: `clamp(28px, ${(((peakHour + 0.5) / 24) * 100).toFixed(1)}%, calc(100% - 34px))` }}
          aria-hidden="true"
        >
          {hourTick(peakHour)} peak
        </span>
      )}

      {/* Scrub: shared vertical guide + this spot's level word at that hour. */}
      {!compact && scrubHour != null && (
        <>
          <span className="tk-hrs-guide" style={{ left: pctX(scrubHour + 0.5) }} aria-hidden="true" />
          <span
            className={cx("tk-hrs-scrub-chip", scrubLevel === 3 && "tk-hrs-scrub-peak")}
            style={{ left: `clamp(34px, ${(((scrubHour + 0.5) / 24) * 100).toFixed(1)}%, calc(100% - 40px))` }}
            aria-hidden="true"
          >
            {scrubLevel != null && scrubLevel !== -1 ? LEVEL_LABEL[scrubLevel] : "—"}
          </span>
        </>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   WeekMiniMap — 7 tiny bars: each day's peak height for this spot, the
   spot's best day in rust. Answers "which days do they perform" at a
   glance; clicking a bar drives the shared day selector.
   ════════════════════════════════════════════════════════════════════ */
function WeekMiniMap({
  entity,
  selectedDay,
  onPick,
}: {
  entity: HoursEntity
  selectedDay: number
  onPick: (d: number) => void
}) {
  const profile = useMemo(() => {
    const peaks = Array.from({ length: 7 }, (_, d) => {
      const dh = entity.days.find((x) => x.day_of_week === d)
      const s = dh?.hourly_scores
      return Array.isArray(s) && s.length ? Math.max(...s) : 0
    })
    let best = -1
    for (let d = 0; d < 7; d++) if (peaks[d] > 0 && (best < 0 || peaks[d] > peaks[best])) best = d
    return { peaks, best }
  }, [entity])

  if (profile.best < 0) return <div className="tk-hrs-week-map" aria-hidden="true" />

  return (
    <div className="tk-hrs-week-map">
      <div className="tk-hrs-wbars" role="group" aria-label={`${entity.name} — strongest days`}>
        {profile.peaks.map((p, d) => (
          <button
            key={d}
            type="button"
            className={cx(
              "tk-hrs-wbar",
              d === profile.best && "tk-hrs-wbar-best",
              d === selectedDay && "tk-hrs-wbar-on",
            )}
            aria-label={`Switch to ${DAY_FULL[d]}`}
            aria-pressed={d === selectedDay}
            onClick={() => onPick(d)}
          >
            {/* px heights (22px bar area) — deterministic for SSR, no %-of-flex quirks */}
            <i style={{ height: `${Math.max(3, Math.round((p / 100) * 22))}px` }} aria-hidden="true" />
            <span aria-hidden="true">{DAY_LETTER[d]}</span>
          </button>
        ))}
      </div>
      <span className="tk-hrs-wbest">
        Best: <b>{DAY_ABBR[profile.best]}</b>
      </span>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   The read line — the picture, answered as the operator's own questions
   ("is everyone slow tonight, or just me?" / "where's my open gap?").
   Pure derivation from the curves; fail-soft (hidden when it has nothing
   confident to say).
   ════════════════════════════════════════════════════════════════════ */
function scoresFor(e: HoursEntity, d: number): number[] | null {
  return e.days.find((x) => x.day_of_week === d)?.hourly_scores ?? null
}

function isActiveAt(e: HoursEntity, d: number, h: number): boolean {
  const dh = e.days.find((x) => x.day_of_week === d)
  if (!dh) return false
  // Posted window OR recorded activity — matches the track's own paint rule.
  if ((dh.hourly_scores?.[h] ?? 0) > 0) return true
  const { eff } = effectiveDay(dh.hours, dh.hourly_scores)
  return eff.open && isOpenAtHour(eff, h)
}

function computeRead(entities: HoursEntity[], day: number): string[] {
  const you = entities.find((e) => e.isYou) ?? null
  const comps = entities.filter((e) => !e.isYou)
  if (comps.length === 0) return []
  const parts: string[] = []

  // (a) When does the set run hot — and are you in that fight? Requires 2+ hot
  //     competitors before claiming a set-wide read; ties break to the hour with
  //     the strongest combined curve (not just the earliest).
  let bestH = -1
  let bestC = 1
  let bestSum = -1
  for (let h = 6; h < 24; h++) {
    let c = 0
    let sum = 0
    for (const e of comps) {
      const s = scoresFor(e, day)
      const v = s ? (s[h] ?? 0) : 0
      if (busyLevel(v) >= 2) c++
      sum += v
    }
    if (c > bestC || (c === bestC && c > 1 && sum > bestSum)) {
      bestC = c
      bestSum = sum
      bestH = h
    }
  }
  if (bestH >= 0) {
    const ys = you ? scoresFor(you, day) : null
    const suffix = !you
      ? ""
      : ys && busyLevel(ys[bestH] ?? 0) >= 2
        ? " — you're in that fight too"
        : " — a quieter hour for you"
    parts.push(`Most of the set runs hot around ${hourTick(bestH)}${suffix}.`)
  }

  // (b) Your clearest window: you're open (or observed active) while every
  //     competitor is quiet or closed, for 2+ hours.
  if (you) {
    let runStart = -1
    let gap: [number, number] | null = null
    for (let h = 0; h <= 24; h++) {
      const inWindow =
        h < 24 &&
        isActiveAt(you, day, h) &&
        comps.every((e) => {
          if (!isActiveAt(e, day, h)) return true // closed counts as clear
          const s = scoresFor(e, day)
          return s ? busyLevel(s[h] ?? 0) <= 0 : false // no curve + open ⇒ not provably quiet
        })
      if (inWindow) {
        if (runStart < 0) runStart = h
      } else if (runStart >= 0) {
        if (!gap || h - runStart > gap[1] - gap[0]) gap = [runStart, h]
        runStart = -1
      }
    }
    if (gap && gap[1] - gap[0] >= 2) {
      parts.push(
        `Your clearest window: ${hourTick(gap[0])} - ${hourTick(gap[1])} — you're open while the rest of the set runs quiet or closed.`,
      )
    }
  }

  return parts
}

/* ════════════════════════════════════════════════════════════════════ */

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
  const [scrubHour, setScrubHour] = useState<number | null>(null)

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
        <TkSectionHead title="Who's busy when" sub="Open hours and each spot's rhythm, by day" />
        <TkEmptyState
          icon={CLOCK_ICON}
          variant="muted"
          title="No rhythm read yet"
          description="We read each spot's open hours and busy pattern from Google Maps. Once a listing is pulled, you'll see when every competitor is open, when each one runs hot, and where the quiet windows are."
        />
      </>
    )
  }

  const dayLabel = DAY_FULL[day]
  const byDay = (e: HoursEntity, d: number): HoursDay | undefined =>
    e.days.find((x) => x.day_of_week === d)
  const readParts = computeRead(entities, day)

  const viz: VizContext = {
    domain: "competitors",
    metric: "Who's busy when",
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

  // Track-level scrub: pointer x → hour, shared across every row so one hover
  // reads the whole set at that hour. Words only — never a bare %.
  function onTrackMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - r.left) / r.width
    if (frac < 0 || frac > 1) return setScrubHour(null)
    setScrubHour(Math.min(23, Math.max(0, Math.floor(frac * 24))))
  }

  return (
    <>
      <TkSectionHead
        title="Who's busy when"
        sub="Open hours and each spot's rhythm against its own normal, by day"
      />
      <RevealOnView>
        <TkCard tBubble={<VizTBubble viz={viz} />}>
          <div className="tk-hrs">
            {/* ── Day controller + level legend ── */}
            <div className="tk-hrs-bar">
              <div className="tk-hrs-days" role="group" aria-label="Choose a day">
                <button type="button" className="tk-hrs-step" onClick={() => step(-1)} aria-label="Previous day">
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
                <button type="button" className="tk-hrs-step" onClick={() => step(1)} aria-label="Next day">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              </div>
              {/* Levels legend: Quiet on the LEFT, peak on the RIGHT, no arrow (ALT-265). */}
              <span className="tk-hrs-legend" aria-hidden="true">
                <span className="tk-hrs-lv"><i className="tk-hrs-lv0" /> Quiet</span>
                <span className="tk-hrs-lv"><i className="tk-hrs-lv1" /> Steady</span>
                <span className="tk-hrs-lv"><i className="tk-hrs-lv2" /> Busy</span>
                <span className="tk-hrs-lv"><i className="tk-hrs-lv3" /> Their peak</span>
                <span className="tk-hrs-leg-x"><span className="tk-hrs-leg-closed" /> closed</span>
                <span className="tk-hrs-leg-x"><span className="tk-hrs-leg-obs" /> observed</span>
              </span>
            </div>

            {/* ── One row per entity for the selected day ── */}
            <div className="tk-hrs-rows">
              {entities.map((e) => {
                const dh = byDay(e, day)
                const hours: DayHours = dh?.hours ?? { known: false, open: false, is24h: false, intervals: [] }
                const obs = !hours.known ? observedWindow(dh?.hourly_scores ?? null) : null
                const isOpenExpanded = expanded.has(e.competitor_id)
                return (
                  <div key={e.competitor_id} className={cx("tk-hrs-row", e.isYou && "tk-hrs-row-you")}>
                    <div className="tk-hrs-rowgrid">
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

                      <div
                        className="tk-hrs-trackwrap"
                        onPointerMove={onTrackMove}
                        onPointerLeave={() => setScrubHour(null)}
                      >
                        <RhythmTrack day={hours} scores={dh?.hourly_scores ?? null} scrubHour={scrubHour} />
                      </div>

                      <WeekMiniMap entity={e} selectedDay={day} onPick={setDay} />
                    </div>

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
                              <RhythmTrack day={wh} scores={wd?.hourly_scores ?? null} compact />
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

            {/* ── Axis — lives in the SAME grid as the rows so the ticks align to
                  the track column's hour positions, never drifting under the name
                  or week-profile columns. ── */}
            <div className="tk-hrs-axis-row" aria-hidden="true">
              <div className="tk-hrs-axis-pad" />
              <div className="tk-hrs-axis">
                {AXIS.map((h) => (
                  <span key={h} style={{ left: pctX(h) }}>
                    {hourTick(h)}
                  </span>
                ))}
              </div>
              <div className="tk-hrs-axis-pad" />
            </div>

            {/* ── The read: the operator's questions, answered from the curves ── */}
            {readParts.length > 0 && (
              <div className="tk-hrs-read">
                <span className="tk-hrs-read-lbl">The read</span>
                <p>{readParts.join(" ")}</p>
              </div>
            )}

            <p className="tk-hrs-foot">
              Open hours and rhythm come from Google Maps popular times. Each curve shows that spot against its
              own normal — &quot;their peak&quot; is the busiest hour of their typical week, whatever size that crowd is.
              This compares timing, never crowd size. When a spot posts no hours, the dashed window shows where
              Google observed activity — marked as observed, never presented as posted hours.
            </p>
          </div>
        </TkCard>
      </RevealOnView>
    </>
  )
}
