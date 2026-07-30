// ---------------------------------------------------------------------------
// Grounded-event date normalizer (Events source migration · P0 step 2)
//
// DataForSEO hands us machine ISO strings. A GROUNDED (generative + google_search)
// source hands us whatever the model wrote: "July 31", "7/31 7pm", "2026-07-10T19:00",
// "Saturday, August 2, 2026 at 8:00 PM". Downstream (localDateOf / parseWallClock /
// the strict `^\d{4}-\d{2}-\d{2}` parse) only trusts a canonical shape, so we coerce
// to EXACTLY that — `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` — and DROP (return null) on
// ambiguity rather than guessing a wrong date. A dropped event is invisible; a
// mis-dated event is the exact Fuerza-Regida-on-the-wrong-day bug this migration exists
// to kill, so silence beats a confident wrong answer.
//
// Pure + deterministic + unit-tested. No `Date.now()` / `new Date()` with no args —
// a bare year like "July 31" (no year) is AMBIGUOUS and therefore DROPPED, never
// back-filled from the wall clock (which would also make the function non-deterministic).
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

/** Validate a (year, month, day) triple as a real calendar date (rejects 2026-02-30, month 13, etc.). */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const daysInMonth = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return d <= daysInMonth[m - 1]
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** Parse an optional time fragment ("7pm", "7:30 PM", "19:00", "at 8 PM") → "HH:MM" (24h), or null. */
function parseTime(raw: string): string | null {
  // 24-hour "HH:MM" (allow a leading T or space; reject a bare date's day-of-month here).
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\s*(?![ap]\.?m)/i.exec(raw)
  // 12-hour "h[:mm] am/pm"
  const h12 = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i.exec(raw)
  if (h12) {
    let hour = Number(h12[1]) % 12
    if (h12[3].toLowerCase() === "p") hour += 12
    const minute = h12[2] ? Number(h12[2]) : 0
    return `${pad2(hour)}:${pad2(minute)}`
  }
  if (h24) {
    return `${pad2(Number(h24[1]))}:${pad2(Number(h24[2]))}`
  }
  return null
}

/**
 * Coerce a messy grounded date string to strict `YYYY-MM-DD` (+ optional `THH:MM`).
 * Returns null when the date is ambiguous or unparseable (no year, no recognizable
 * month/day, or an impossible calendar date) — the caller DROPS such events.
 */
export function normalizeGroundedDate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null
  const s = raw.trim()
  if (!s) return null

  const time = parseTime(s)
  const withTime = (date: string): string => (time ? `${date}T${time}` : date)

  // 1. Already ISO-ish: "2026-07-31", "2026-07-31T19:00[:00][Z|+00:00]". Trust the date portion;
  //    re-derive the time from our own parser so a "+00:00" wall-clock isn't re-projected later.
  // NB: no trailing \b — a following "T19:05" is a word char, so \b would fail on datetimes.
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    if (!isRealDate(y, m, d)) return null
    // Prefer an explicit "T"/space HH:MM already in the ISO string; else any time fragment.
    const isoTime = /[T ]([01]?\d|2[0-3]):([0-5]\d)/.exec(s)
    const t = isoTime ? `${pad2(Number(isoTime[1]))}:${pad2(Number(isoTime[2]))}` : time
    const date = `${y}-${pad2(m)}-${pad2(d)}`
    return t ? `${date}T${t}` : date
  }

  // 2. "Month DD, YYYY" / "Month DD YYYY" / "DD Month YYYY" / "Weekday, Month DD, YYYY at ...".
  const monthName = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(s)
  if (monthName && MONTHS[monthName[1].toLowerCase()]) {
    const m = MONTHS[monthName[1].toLowerCase()]
    const d = Number(monthName[2])
    const y = Number(monthName[3])
    if (isRealDate(y, m, d)) return withTime(`${y}-${pad2(m)}-${pad2(d)}`)
  }
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/i.exec(s)
  if (dayFirst && MONTHS[dayFirst[2].toLowerCase()]) {
    const d = Number(dayFirst[1])
    const m = MONTHS[dayFirst[2].toLowerCase()]
    const y = Number(dayFirst[3])
    if (isRealDate(y, m, d)) return withTime(`${y}-${pad2(m)}-${pad2(d)}`)
  }

  // 3. Numeric "M/D/YYYY" or "MM/DD/YYYY" (US order — the grounded source is US-locale English).
  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s)
  if (slash) {
    const m = Number(slash[1])
    const d = Number(slash[2])
    const y = Number(slash[3])
    if (isRealDate(y, m, d)) return withTime(`${y}-${pad2(m)}-${pad2(d)}`)
  }

  // 4. No 4-digit year anywhere → AMBIGUOUS ("July 31", "7/31 7pm"). DROP — never guess a year.
  return null
}
