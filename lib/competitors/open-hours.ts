// ALT-231 — parse Google Places opening-hours into per-day OPEN WINDOWS so the
// competitor "open hours" widget can draw a 24-hour bar per spot (breakfast-only,
// open-late, 24-hour, split shifts).
//
// SOURCE: Google Places `regularOpeningHours.weekdayDescriptions` — an array of
// human-readable lines, one per day, e.g. "Monday: 10:00 AM – 11:00 PM". We parse
// the RAW lines (NOT the insights-pipeline `raw_data.hours` record, whose value is
// truncated by a `line.split(":")` that breaks on the time's own colon) so the
// windows stay intact.
//
// HONEST: when a day's line is missing or unparseable we return `known: false`
// (open: false). The widget renders that as "hours unavailable" — we never invent
// an open window. Overnight windows (e.g. "5 PM – 2 AM") are clipped to the day
// they're listed under; the after-midnight tail shows on the next day's own line.

/** An open window within a single day, in hour units. Half-open: a clock hour `h`
 *  (covering [h, h+1)) is open when `start <= h < end`. `end` may be 24 (midnight). */
export type OpenInterval = { start: number; end: number }

export type DayHours = {
  /** Did we successfully read this day's hours at all? false ⇒ render "unavailable". */
  known: boolean
  /** Open for any part of the day. */
  open: boolean
  /** Open the full 24 hours. */
  is24h: boolean
  /** Open windows within [0, 24]; overnight spillover is clipped to this day. */
  intervals: OpenInterval[]
}

const DAY_NAME_TO_DOW: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const CLOSED: DayHours = { known: true, open: false, is24h: false, intervals: [] }
const UNKNOWN: DayHours = { known: false, open: false, is24h: false, intervals: [] }

/** Normalize the dashes, unicode spaces and "to" separators Google uses into a
 *  single " - " range delimiter, and collapse whitespace. */
function normalizeSpan(raw: string): string {
  return raw
    // en dash, em dash, minus, hyphen variants, and the word "to" → a plain hyphen
    .replace(/–|—|−|－/g, "-")
    .replace(/\s+to\s+/gi, " - ")
    // non-breaking / thin / narrow-no-break spaces → normal space
    .replace(/[    ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Parse a clock time ("10:00 AM", "9 PM", "10:30 am") into minutes-of-day 0..1439,
 *  or null when it isn't a time. 24-hour times ("13:00") are accepted too. */
function parseClock(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/)
  if (!m) return null
  let hour = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (min > 59) return null
  const mer = m[3]?.replace(/\./g, "")
  if (mer === "am") {
    if (hour === 12) hour = 0
    if (hour > 12) return null
  } else if (mer === "pm") {
    if (hour !== 12) hour += 12
    if (hour > 24) return null
  } else if (hour > 23) {
    return null
  }
  return hour * 60 + min
}

/** Turn one open–close pair (in minutes) into a same-day hour interval, or null.
 *  start floors to the hour, end ceils (so a 10:30 open still lights the 10 o'clock
 *  cell and a 10:30pm close still lights the 10 o'clock cell). Overnight windows
 *  (close <= open, or close at exactly midnight) clip to the end of this day. */
function toInterval(openMin: number, closeMin: number): OpenInterval | null {
  const start = Math.floor(openMin / 60)
  // Midnight close (0) and any close not strictly after open ⇒ runs to end of day.
  const end = closeMin === 0 || closeMin <= openMin ? 24 : Math.min(24, Math.ceil(closeMin / 60))
  if (!(start >= 0 && start < 24 && end > start)) return null
  return { start, end }
}

/** Merge overlapping/touching intervals (sorted) so a split-shift bar paints clean. */
function mergeIntervals(intervals: OpenInterval[]): OpenInterval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const out: OpenInterval[] = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end)
    else out.push({ ...iv })
  }
  return out
}

/** Parse the TIME-SPAN portion of a day's hours (everything after the day name),
 *  e.g. "10:00 AM – 11:00 PM" or "7 AM – 2 PM, 5 PM – 10 PM" or "Open 24 hours". */
export function parseSpan(spanRaw: string | null | undefined): DayHours {
  if (spanRaw == null) return UNKNOWN
  const span = normalizeSpan(spanRaw)
  if (!span) return UNKNOWN
  const lower = span.toLowerCase()

  if (/\bclosed\b/.test(lower)) return CLOSED
  if (/\b(open\s+)?24\s*hours\b/.test(lower) || /\bopen\s+24\b/.test(lower)) {
    return { known: true, open: true, is24h: true, intervals: [{ start: 0, end: 24 }] }
  }

  const intervals: OpenInterval[] = []
  for (const part of span.split(",")) {
    const [from, to] = part.split("-").map((p) => p.trim())
    if (!from || !to) continue
    const openMin = parseClock(from)
    const closeMin = parseClock(to)
    if (openMin == null || closeMin == null) continue
    const iv = toInterval(openMin, closeMin)
    if (iv) intervals.push(iv)
  }

  if (intervals.length === 0) return UNKNOWN
  const merged = mergeIntervals(intervals)
  const is24h = merged.length === 1 && merged[0].start === 0 && merged[0].end === 24
  return { known: true, open: true, is24h, intervals: merged }
}

/** Parse one full weekday-description line ("Monday: 10:00 AM – 11:00 PM").
 *  Returns the day-of-week (0=Sun, or null when the day name isn't recognized)
 *  and the parsed hours. Splits on the FIRST colon only, so the time keeps its own. */
export function parseDayLine(line: string | null | undefined): { dow: number | null; hours: DayHours } {
  if (!line) return { dow: null, hours: UNKNOWN }
  const idx = line.indexOf(":")
  if (idx < 0) {
    // No "Day:" prefix — treat the whole line as a span (e.g. a bare value).
    return { dow: null, hours: parseSpan(line) }
  }
  const dayName = line.slice(0, idx).trim().toLowerCase()
  const dow = dayName in DAY_NAME_TO_DOW ? DAY_NAME_TO_DOW[dayName] : null
  return { dow, hours: parseSpan(line.slice(idx + 1)) }
}

/** Parse Google's `weekdayDescriptions` array into hours keyed by day-of-week
 *  (0=Sun … 6=Sat). Days the source doesn't mention are left absent (caller treats
 *  a missing key as `known: false`). Robust to locale day order — we key off the
 *  day NAME in each line, not the array index. */
export function parseWeekdayDescriptions(
  lines: string[] | null | undefined,
): Record<number, DayHours> {
  const out: Record<number, DayHours> = {}
  if (!Array.isArray(lines)) return out
  for (const line of lines) {
    const { dow, hours } = parseDayLine(line)
    if (dow != null) out[dow] = hours
  }
  return out
}

/** Is the spot open during clock hour `h` (0..23) on this day? */
export function isOpenAtHour(day: DayHours | undefined, h: number): boolean {
  if (!day || !day.open) return false
  return day.intervals.some((iv) => h >= iv.start && h < iv.end)
}

/** Total open hours in a day (for ranking / "open longest" reads). */
export function openHourCount(day: DayHours | undefined): number {
  if (!day || !day.open) return 0
  return day.intervals.reduce((s, iv) => s + (iv.end - iv.start), 0)
}

const H12 = (h: number): string => {
  // 0..24 → "12 AM" … "11 PM" … "12 AM"; on the hour only (axis/labels).
  const hh = ((h % 24) + 24) % 24
  const mer = hh < 12 ? "AM" : "PM"
  const base = hh % 12 === 0 ? 12 : hh % 12
  return `${base} ${mer}`
}

/** A short, plain-language label for a day's window: "Closed", "Open 24 hours",
 *  "10 AM - 11 PM", "7 AM - 2 PM, 5 - 10 PM", or "Hours unavailable". No restaurant
 *  lingo; a hyphen range (NOT an en/em dash) per the Ticket voice rules. */
export function openLabel(day: DayHours | undefined): string {
  if (!day || !day.known) return "Hours unavailable"
  if (day.is24h) return "Open 24 hours"
  if (!day.open || day.intervals.length === 0) return "Closed"
  return day.intervals
    .map((iv) => `${H12(iv.start)} - ${H12(iv.end)}`)
    .join(", ")
}

/** ALT-264 — the window where Google observed activity (busy > 0) on a day, for
 *  spots whose POSTED hours we can't read. Google's popular-times curve is only
 *  nonzero while a place is open, so the active span is an honest "we saw activity
 *  here" window — one conservative span from the first to the last active hour.
 *  Presented as observed activity, never as posted hours. */
export function observedWindow(scores: number[] | null | undefined): OpenInterval | null {
  if (!Array.isArray(scores)) return null
  let first = -1
  let last = -1
  const n = Math.min(24, scores.length)
  for (let h = 0; h < n; h++) {
    if ((scores[h] ?? 0) > 0) {
      if (first < 0) first = h
      last = h
    }
  }
  if (first < 0) return null
  return { start: first, end: Math.min(24, last + 1) }
}

/** Label for an observed-activity window: "Observed 10 AM - 10 PM". */
export function observedLabel(iv: OpenInterval): string {
  return `Observed ${H12(iv.start)} - ${H12(iv.end)}`
}
