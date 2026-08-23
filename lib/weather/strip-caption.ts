// ---------------------------------------------------------------------------
// ALT-718 — what the "Next 7" strip is actually showing.
//
// The strip tops itself up from recent history when the forecast is short, so the lead always shows
// a full week. That is a good idea and stays. The bug was the LABEL: the caption said "Next 7"
// unconditionally, so when `fetchForecast` threw and `forecastDays` came back empty, the strip
// filled with the SEVEN MOST RECENT PAST DAYS and presented them as the week ahead. An operator
// reading last week's weather as this week's forecast plans staffing against it.
//
// The caption half was fixed in the page. This module exists for the half that was left: the
// individual CELLS still render nothing but a weekday abbreviation, so in the MIXED case
// ("Next 3 + recent history") four of the seven cells are history and look identical to the three
// that are not. The caption tells you the shape; it cannot tell you WHICH.
//
// Extracted out of app/(dashboard)/weather/page.tsx rather than left inline because `vitest` only
// collects `tests/unit/**/*.test.ts` and never `.tsx`, so logic inside a page component cannot be
// tested at all. This is the decision that was silently wrong for a while; it should be the part
// that is easiest to assert.
// ---------------------------------------------------------------------------

/** The only field of a strip day this module needs. */
export type StripDayLike = { isForecast?: boolean | null }

export type StripDescription = {
  /** The caption above the strip. */
  caption: string
  /** How many of the visible days are genuinely forecast. */
  forecastCount: number
  /** True when the strip is entirely history, i.e. the forecast fetch gave us nothing. */
  isAllHistory: boolean
  /** True when history and forecast are mixed, which is the case the cells must disambiguate. */
  isMixed: boolean
}

/**
 * Describe what the strip is showing, from the days themselves.
 *
 * Counted off `isForecast`, which the page's own mapping already sets, rather than re-derived from
 * dates against a clock. One source of truth for "is this a forecast day", and no timezone
 * arithmetic in a caption.
 */
export function describeStripDays(days: readonly StripDayLike[]): StripDescription {
  const total = days.length
  const forecastCount = days.filter((d) => d.isForecast === true).length
  const isAllHistory = total > 0 && forecastCount === 0
  const isMixed = forecastCount > 0 && forecastCount < total

  const caption = isAllHistory
    ? "Last 7 days · forecast unavailable right now"
    : isMixed
      ? `Next ${forecastCount} + recent history · forecast & estimated walk-in demand`
      : "Next 7 · forecast & estimated walk-in demand"

  return { caption, forecastCount, isAllHistory, isMixed }
}

/**
 * Should this cell be marked as history rather than forecast?
 *
 * Only when the strip is MIXED. In the all-history case the caption already says so in words, and
 * marking all seven cells would be noise that reads as an error state. In the all-forecast case
 * there is nothing to distinguish.
 */
export function shouldMarkAsPast(day: StripDayLike, description: StripDescription): boolean {
  return description.isMixed && day.isForecast !== true
}
