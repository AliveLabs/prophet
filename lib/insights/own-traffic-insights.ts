// ---------------------------------------------------------------------------
// T2 — Own-scoped demand-curve rules.
//
// Every existing traffic/hours rule output (lib/insights/traffic-insights.ts) is
// COMPETITOR-scoped. The operator's own popular-times curve (`location.busyTimes`,
// sourced at lib/insights/dossier/build.ts) existed only as prompt CONTEXT, never as
// a first-class citable ref — so the flagship plays that reason about the operator's
// OWN rhythm (own-the-lull, daypart surgery, deploy-to-the-curve) had no grounded
// evidence to cite. This module emits deterministic GeneratedInsight rows FROM the
// own curve, named as the operator ("Your ...", entity-attributed, competitor_id null).
//
// NAMING — READ BEFORE TOUCHING: these rules use the `hours.own_*` prefix, NOT
// `traffic.own_*`. convergence@v2's signalFamily() (lib/skills/convergence/skill.ts,
// once that PR lands) buckets `traffic.*` and `hours*` into DIFFERENT families —
// `traffic.own_*` would collapse into the SAME family as the competitor busy-curve
// signals, and the founder's flagship combined play (own curve x competitor curve x
// events) would count only 2 families and die at convergence's >=3-family gate. Under
// today's v1 domain tokenizer (lib/skills/evidence-format.ts domainLabel — leading
// dotted token) `hours.own_*` and `traffic.*` are ALSO already distinct ("Hours" vs
// "Traffic"), so this naming is safe under both the current skill and the pending v2
// rewrite. Operations' and marketing's intake predicates both match via
// `t.startsWith("hours")` (lib/skills/operations/skill.ts isHoursSignal,
// lib/skills/marketing/skill.ts isRhythmSignal) — verified, see tests.
//
// hours.own_peak_drift (own peak moved vs history) is NOT implemented here. Verified:
// the operator's own curve is persisted in `location_busy_times`, upserted on
// (location_id, day_of_week) — see lib/events/baseline.ts ensureLocationBaseline. That
// upsert OVERWRITES the prior row; no dated history is retained (unlike a per-date_key
// table). There is therefore no "previous own curve" to diff against today. T1 builds
// competitor snapshot history; own-curve history would need the same kind of
// per-date_key plumbing, which is out of scope here — do not build speculative storage
// for a rule with nothing to compare against. Skipping this rule is intentional.
// ---------------------------------------------------------------------------

import type { GeneratedInsight } from "./types"
import { parseWeekdayDescriptions, isOpenAtHour, type DayHours } from "@/lib/competitors/open-hours"
import type { BusyTimesResult } from "@/lib/providers/outscraper"

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function formatHour(h: number): string {
  const hh = ((h % 24) + 24) % 24
  if (hh === 0) return "12am"
  if (hh === 12) return "12pm"
  return hh < 12 ? `${hh}am` : `${hh - 12}pm`
}

/** Ordinal level word for a popular-times score (0-100). NEVER surface the raw
 *  number in title/summary text — evidence keys may carry it (not user-facing copy). */
function levelWord(score: number): "dead" | "quiet" | "moderate" | "busy" | "packed" {
  if (score < 10) return "dead"
  if (score < 30) return "quiet"
  if (score < 55) return "moderate"
  if (score < 80) return "busy"
  return "packed"
}

export type OwnTrafficInsightInput = {
  /** The operator's own live busy-times pull (dossier's `location.busyTimes`). */
  busyTimes: BusyTimesResult | null | undefined
  /** Posted-hours lines (Google's weekdayDescriptions) for the open-window gate. */
  weekdayDescriptions?: string[] | null
  /** How many independent weekly observations back this curve. A single live
   *  Outscraper pull (today's only source — see file header) is 1. Wire up to the
   *  real count once own-curve history exists; defaults conservatively to 1. */
  sampleWeeks?: number
}

const MIN_SAMPLE_WEEKS_FOR_WARNING = 3

/** hours.own_dead_edge_hour — the first or last OPEN hour of a service day scores
 *  consistently dead vs that day's own mean. Actionable (a real edge-hour close/staff
 *  call) -> severity warning, IF sampleWeeks clears the gate; otherwise capped at info
 *  and the summary says so (single-capture basis). */
function ownDeadEdgeHourInsights(
  scoresByDow: Map<number, number[]>,
  hoursByDow: Record<number, DayHours>,
  sampleWeeks: number,
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  for (const [dow, scores] of scoresByDow) {
    const dayHours = hoursByDow[dow]
    if (!dayHours || !dayHours.known || !dayHours.open) continue // no posted hours -> no edge-hour claim

    const openHours = Array.from({ length: 24 }, (_, h) => h).filter((h) => isOpenAtHour(dayHours, h))
    if (openHours.length < 2) continue // need a real edge, not a single-hour day

    const mean = openHours.reduce((s, h) => s + (scores[h] ?? 0), 0) / openHours.length
    if (mean <= 0) continue // nothing to be "dead vs" if the whole day reads flat zero

    const first = openHours[0]
    const last = openHours[openHours.length - 1]
    // An edge hour qualifies when it scores at least 60% below the day's own mean AND
    // itself reads "dead"/"quiet" in level-word terms — both a relative AND an
    // absolute floor, so a merely-quieter-than-average busy day doesn't false-fire.
    const edgeCandidates = [
      { hour: first, position: "opening" as const },
      { hour: last, position: "closing" as const },
    ].filter(({ hour }) => {
      const score = scores[hour] ?? 0
      const word = levelWord(score)
      return score <= mean * 0.4 && (word === "dead" || word === "quiet")
    })

    for (const { hour, position } of edgeCandidates) {
      const dayName = DAY_NAMES[dow]
      const severity = sampleWeeks >= MIN_SAMPLE_WEEKS_FOR_WARNING ? "warning" : "info"
      const basisNote =
        sampleWeeks >= MIN_SAMPLE_WEEKS_FOR_WARNING
          ? ""
          : " (based on a single recent read — confirm over a few more weeks)"
      insights.push({
        insight_type: "hours.own_dead_edge_hour",
        title: `Your ${dayName} ${position} hour runs quiet`,
        summary: `Your ${formatHour(hour)} ${position} hour on ${dayName}s reads well below your own typical pace for the day${basisNote}.`,
        confidence: sampleWeeks >= MIN_SAMPLE_WEEKS_FOR_WARNING ? "medium" : "low",
        severity,
        evidence: {
          entity: "own",
          day: dayName,
          day_of_week: dow,
          hour,
          hours_context: position,
          sampleWeeks,
        },
        recommendations: [],
      })
    }
  }

  return insights
}

/** hours.own_slow_window — a mid-service window (not an open/close edge) consistently
 *  far below the location's own typical curve. Context-grade for marketing's lull
 *  play, not a staffing directive itself -> severity info. */
function ownSlowWindowInsights(
  scoresByDow: Map<number, number[]>,
  hoursByDow: Record<number, DayHours>,
  sampleWeeks: number,
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  for (const [dow, scores] of scoresByDow) {
    const dayHours = hoursByDow[dow]
    if (!dayHours || !dayHours.known || !dayHours.open) continue

    const openHours = Array.from({ length: 24 }, (_, h) => h).filter((h) => isOpenAtHour(dayHours, h))
    if (openHours.length < 4) continue // need room for an interior window distinct from the edges

    const mean = openHours.reduce((s, h) => s + (scores[h] ?? 0), 0) / openHours.length
    if (mean <= 0) continue

    const first = openHours[0]
    const last = openHours[openHours.length - 1]
    const interiorHours = openHours.filter((h) => h !== first && h !== last)

    // A run of >=2 consecutive interior hours each <=50% of the day's mean.
    let run: number[] = []
    const flushRun = () => {
      if (run.length >= 2) {
        const startHour = run[0]
        const endHour = run[run.length - 1]
        const dayName = DAY_NAMES[dow]
        const severity = "info" as const // always context-grade, per spec
        const basisNote =
          sampleWeeks >= MIN_SAMPLE_WEEKS_FOR_WARNING
            ? ""
            : " (based on a single recent read)"
        insights.push({
          insight_type: "hours.own_slow_window",
          title: `Your ${dayName} midday stretch runs quiet`,
          summary: `Your ${formatHour(startHour)}-${formatHour(endHour + 1)} window on ${dayName}s sits well below your own usual pace${basisNote}.`,
          confidence: sampleWeeks >= MIN_SAMPLE_WEEKS_FOR_WARNING ? "medium" : "low",
          severity,
          evidence: {
            entity: "own",
            day: dayName,
            day_of_week: dow,
            hours: run.slice(),
            sampleWeeks,
          },
          recommendations: [],
        })
      }
      run = []
    }

    for (const h of interiorHours) {
      const score = scores[h] ?? 0
      const isSlow = score <= mean * 0.5
      if (isSlow) {
        run.push(h)
      } else {
        flushRun()
      }
    }
    flushRun()
  }

  return insights
}

/** Build the day-of-week -> hourly_scores map from a live BusyTimesResult. */
function scoresByDowFrom(busyTimes: BusyTimesResult): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const day of busyTimes.days) {
    out.set(day.day_of_week, day.hourly_scores)
  }
  return out
}

/** Entry point — mirrors traffic-insights.ts conventions. Fails soft (empty array)
 *  when there's no own curve or no posted hours to gate against (never fabricates
 *  an open window). hours.own_peak_drift is intentionally absent — see file header. */
export function generateOwnTrafficInsights(input: OwnTrafficInsightInput): GeneratedInsight[] {
  const { busyTimes, weekdayDescriptions, sampleWeeks = 1 } = input
  if (!busyTimes || !Array.isArray(busyTimes.days) || busyTimes.days.length === 0) return []

  const hoursByDow = parseWeekdayDescriptions(weekdayDescriptions)
  const scoresByDow = scoresByDowFrom(busyTimes)

  return [
    ...ownDeadEdgeHourInsights(scoresByDow, hoursByDow, sampleWeeks),
    ...ownSlowWindowInsights(scoresByDow, hoursByDow, sampleWeeks),
  ]
}
