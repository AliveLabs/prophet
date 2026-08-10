// ---------------------------------------------------------------------------
// Event title + start-time safety (2026-08-10)
//
// Context: with EVENTS_SOURCE=grounded live, event data is now generated rather than
// scraped, and a generative source fails in two specific ways that a scraper does not:
//
//   1. It emits PLACEHOLDER titles when it half-knows an event.
//      Real example from prod: "Dallas Wings vs. [Opponent Not Specified]".
//      5 of 286 events on the first grounded run.
//   2. It asserts a MIDNIGHT start when it does not know the time.
//      26 of 286 events came back with a `T00:00` start. Those are not midnight
//      events; they are events whose time the model could not verify.
//
// Both are load-bearing because the P13 name-suppression gate is being dropped in the
// same change: once copy names events, a placeholder title reaches an operator verbatim.
// The suppression was accidentally masking this. Titles must be gated BEFORE naming.
//
// Pure + deterministic + unit-tested. No network, no model.
// ---------------------------------------------------------------------------

/** Bracketed slots, explicit unknowns, and the model's hedge vocabulary. A title matching
 *  any of these is a half-answer, not a name, and must never reach customer copy. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /[[\]{}]/,                                    // "vs. [Opponent Not Specified]", "{team}"
  /\bnot specified\b/i,
  /\bunspecified\b/i,
  /\bto be (announced|determined|confirmed)\b/i,
  /\bTBA\b/,
  /\bTBD\b/,
  /\bunknown\b/i,
  /\bopponent\b/i,                              // "vs. Opponent" with no real name
  /\bplaceholder\b/i,
  /\bvs\.?\s*$/i,                               // dangling "vs." with nothing after it
  /\bN\/A\b/i,
]

/** Titles too thin to be a name even when free of placeholder markers. */
const MIN_TITLE_LENGTH = 3

/** Is this title safe to show an operator verbatim?
 *  Conservative by design: when in doubt we fall back to generic phrasing, because a
 *  vague-but-true line beats a confident-looking placeholder. */
export function isSafeEventTitle(title: string | null | undefined): boolean {
  const t = (title ?? "").trim()
  if (t.length < MIN_TITLE_LENGTH) return false
  return !PLACEHOLDER_PATTERNS.some((re) => re.test(t))
}

/** Ancillary facilities that share a venue's name and coordinates but are not the thing
 *  that fills it: the tours desk, the team store, a fan zone, an overflow parking lot.
 *
 *  Lives here rather than in relevance.ts because BOTH the magnitude classifier and the
 *  venue-catalog coordinate matcher need it, and this module imports nothing (no cycle).
 *  Real prod damage from not having it: the catalog entry "AT&T Stadium Tours" (capacity
 *  500) sat 0.013mi from "Dallas Stadium" (capacity 90,000), so a nearest-wins coordinate
 *  match handed a sold-out stadium concert the gift shop's capacity. */
const NON_DRAW_VENUE_NAME =
  /\b(tours?|fan zone|fan viewing zone|viewing zone|watch party|box office|ticket office|gift shop|pro shop|team store|museum|lot \d+|parking)\b/i

export function isNonDrawVenueName(name: string | null | undefined): boolean {
  return NON_DRAW_VENUE_NAME.test(name ?? "")
}

/** A midnight start is the generative source's way of saying "I don't know the time".
 *  Real events at exactly 00:00 are vanishingly rare compared to unverified ones, so we
 *  treat `T00:00` as an ABSENT time rather than assert it. */
export function hasUnverifiedStartTime(startDatetime: string | null | undefined): boolean {
  if (!startDatetime) return true
  return /T00:00(:00)?/.test(startDatetime)
}

/** Strip an unverified time down to the date, so downstream copy says "Sat, Aug 15"
 *  instead of "Sat, Aug 15 at 12:00 AM". Returns the input unchanged when the time is
 *  real, and null when there is nothing usable at all. */
export function dropUnverifiedTime(startDatetime: string | null | undefined): string | null {
  if (!startDatetime) return null
  if (!hasUnverifiedStartTime(startDatetime)) return startDatetime
  const m = startDatetime.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}
