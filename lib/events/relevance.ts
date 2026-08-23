// ---------------------------------------------------------------------------
// Event relevance — distance × magnitude → ROLE (Event geo-relevance · Layer 2)
//
// Distance doesn't delete an event; it changes its ROLE (Bryan, 2026-06-09):
//   • local_foot    (≤ ~0.5 mi)  — can claim WALK-IN / foot-traffic impact
//   • local_traffic (≤ ~3 mi)    — can claim local traffic/prep impact
//   • metro_hook    (far + MAJOR)— marketing tie-in ONLY (e.g. "Mavs win = free
//                                  appetizer", watch-party angle). Surfaces only
//                                  when a concrete play exists; impact scored low;
//                                  NEVER framed as nearby demand. Pretest proved
//                                  the model won't self-gate on distance data —
//                                  these are delivered via a SEPARATE channel.
//   • out_of_area   (far + minor)— invisible to the engine
//   • ungeocoded    (no venue fix)— anti-fabrication: can't claim local without a
//                                  measured distance; treated as out-of-area
// Pure functions, unit-tested; thresholds tunable in one place.
// ---------------------------------------------------------------------------

import type { NormalizedEvent, EventType } from "./types"
import type { DensityClass } from "@/lib/local/census-density"
import { isNonDrawVenueName } from "./title-safety"

export const PROXIMITY = {
  footMiles: 0.5,
  trafficMiles: 3.0, // Bryan: "5 or less, maybe even 3 or less" — start strict
} as const

// ── R2: density-scaled relevance radius (§3.3) ──────────────────────────────
// "Local" is relative to how dense the surroundings are: in a dense urban core a draw a
// quarter-mile away is the relevant ring and 3mi is metro noise; in the country a game
// 4mi up the road is still "in town". So the foot/traffic thresholds become a FUNCTION of
// the TRUE density class (from the Census R2 source) instead of the fixed 0.5/3.0mi.
//
// GRACEFUL NO-OP: when the density class is UNKNOWN (no CENSUS_API_KEY / Census failed /
// the caller passes nothing), we use the suburban ring — which is EXACTLY today's
// PROXIMITY.footMiles / trafficMiles — so the no-Census path is byte-identical to prod.
export type ProximityRing = { footMiles: number; trafficMiles: number }

export const DENSITY_RINGS: Record<DensityClass, ProximityRing> = {
  dense_urban: { footMiles: 0.3, trafficMiles: 1.0 },
  suburban: { footMiles: PROXIMITY.footMiles, trafficMiles: PROXIMITY.trafficMiles }, // = today (0.5 / 3.0)
  rural: { footMiles: 0.75, trafficMiles: 5.0 },
} as const

/** The proximity ring for a density class. Unknown/undefined class → suburban (today's
 *  exact 0.5/3.0mi), so omitting density is byte-identical to current behavior. */
export function proximityRingFor(densityClass: DensityClass | null | undefined): ProximityRing {
  return densityClass ? DENSITY_RINGS[densityClass] : DENSITY_RINGS.suburban
}

export type EventMagnitude = "major" | "moderate" | "minor"
export type EventRole = "local_foot" | "local_traffic" | "metro_hook" | "route_corridor" | "out_of_area" | "ungeocoded"

// Venue-class + league/event keywords. Conservative: "major" needs a stadium-class
// venue or a pro-league/headline keyword — metro hooks are the exception, not the rule.
// ALT-572. `pavilion`, `ballpark`, `dome` and a standalone `field` were missing, and each names a
// venue class that is never small. Confirmed against live prod rows on 2026-08-22, where all four of
// these were classified MINOR:
//
//   "Los Angeles Angels at Texas Rangers"       Globe Life Field      (40k MLB ballpark)
//   "Double Trouble Double Vision Tour 2026"    Dos Equis Pavilion    (~20k amphitheatre)
//   "Extreme"                                   Dos Equis Pavilion
//   "Jack Johnson"                              Morton Amphitheater
//
// `\bfield\b` needs the word boundary and does not match "Springfield", which is the only false
// positive worth worrying about. `bowl` and `center` were already here and carry the same risk.
// ⚠️ `amphitheat\w*`, not `amphitheat`. Inside `\b(...)\b` the bare stem could never match a real
// venue: after consuming "amphitheat" the next character in "Amphitheater" is a word character, so
// the trailing `\b` fails. Verified against the original pattern: "Morton Amphitheater" -> false,
// "Dos Equis Amphitheatre" -> false, and only the nonexistent "Toyota Amphitheat" -> true. That
// alternative had been dead since it was written, which is why "Jack Johnson" at Morton
// Amphitheater came through as minor.
const MAJOR_VENUE = /\b(stadium|arena|speedway|amphitheat\w*|fairgrounds|coliseum|bowl|ballpark|pavilion|dome|field house|field|center)\b/i
const MAJOR_EVENT = /\b(nfl|nba|mlb|nhl|mls|ncaa|fifa|playoff|championship|final|cup|world cup|super bowl|grand prix|formula 1|monster jam|rodeo|state fair)\b/i
// no bare "tour" — a club tour is small; a stadium tour qualifies on the venue instead
const MODERATE_EVENT = /\b(festival|fest|concert|expo|convention|marathon|parade)\b/i

// Route / street-closure events: not point venues — the route can pass the block from a
// "start venue" miles away. Detected by title so they're treated as access-disruption, not draw.
const ROUTE_EVENT = /\b(marathon|half[- ]?marathon|10k|5k|fun run|road race|grand prix|criterium|parade|street fest|bike race|cycling|triathlon|relay race)\b/i

export function isRouteEventTitle(title: string | null | undefined): boolean {
  return ROUTE_EVENT.test(title ?? "")
}

// ── Non-draw facilities (2026-08-10) ────────────────────────────────────────
// A big-venue NAME is not the same as a big-venue EVENT. The grounded source returns
// facility listings alongside real events, and because they carry a stadium-class venue
// string they were being scored as major draws. Observed in prod: "AT&T Stadium Tours"
// and a "FIFA World Cup Fan Viewing Zone" (a tournament that ended in July) both surfaced
// to an operator as major events.
//
// These are ancillary facilities at a venue, not the thing that fills it. Matched on the
// VENUE name so a legitimate stadium concert is untouched: "BTS World Tour" at venue
// "AT&T Stadium" stays major, while the same title at "AT&T Stadium Tours" does not.
// Deliberately NOT matching bare "tour" in the title, since stadium tours by artists are
// exactly the marquee case this engine exists to catch.
const NON_DRAW_TITLE = /\b(stadium tour|venue tour|guided tour|self[- ]guided|behind[- ]the[- ]scenes)\b/i

export function isNonDrawListing(
  e: Pick<NormalizedEvent, "title" | "venue">,
): boolean {
  return isNonDrawVenueName(e.venue?.name) || NON_DRAW_TITLE.test(e.title ?? "")
}

/**
 * Venue words that name an unambiguously large-capacity venue CLASS.
 *
 * Narrower than MAJOR_VENUE on purpose. MAJOR_VENUE also carries `center`, `bowl` and `field house`,
 * and `center` in particular is common in names that are not large rooms at all ("Frisco Athletic
 * Center Waterpark", "Willow Bend Center of the Arts"). Those stay useful as one signal among
 * several but must not by themselves set a floor, or every leisure centre in the metro becomes a
 * moderate draw.
 *
 * `field` IS here, deliberately. As a venue-name word it is overwhelmingly a ballpark or stadium
 * (Globe Life Field, Riders Field, Wrigley Field, Citi Field), and `\b` means it does not match
 * "Springfield". Tests pin both directions.
 */
const LARGE_VENUE = /\b(stadium|arena|speedway|amphitheat\w*|coliseum|ballpark|pavilion|dome|fairgrounds|field)\b/i

/**
 * ⚠️ `ticketsAndInfo.length` is a SCRAPE ARTIFACT, not a property of the event, and it used to be
 * the deciding signal in three of the four rules below.
 *
 * Proof from one day of live prod rows (2026-08-22): the same fixture at the same venue appears
 * with different counts. "Royals vs Blue Jays" at Kauffman Stadium carried 1 ticket link on three
 * rows while "Royals vs Tigers" at the same venue carried 2, and "Chiefs vs Seahawks" at Arrowhead
 * carried **0**. Identical event classes, different counts, purely a function of what the source
 * happened to list. Gating "major" on `>= 2` therefore assigned magnitude by coin flip.
 *
 * It survives as a corroborator that can PROMOTE ("BTS World Tour" at AT&T Stadium with ticket
 * links is major, and that is right). What it must never do again is DEMOTE: its absence used to
 * drop a stadium event all the way to minor, which is what this fixes. Promotion on a noisy signal
 * costs an over-called event; demotion on a noisy signal loses the marquee event entirely.
 */
export function classifyEventMagnitude(e: Pick<NormalizedEvent, "title" | "venue" | "ticketsAndInfo">): EventMagnitude {
  const venue = e.venue?.name ?? ""
  const title = e.title ?? ""
  const ticketed = (e.ticketsAndInfo?.length ?? 0) >= 2
  // A facility listing can never be a major draw, however stadium-shaped its venue string.
  if (isNonDrawListing(e)) return "minor"

  // A headline event, or any sports fixture, in a large-venue class. No ticket-count requirement:
  // "Chiefs vs Seahawks" at Arrowhead came through with zero ticket links and was only rescued by
  // the catalog capacity upgrade in annotate.ts. Where the catalog has no row (Globe Life Field and
  // Dos Equis Pavilion both return null capacity today) nothing rescued it.
  if (LARGE_VENUE.test(venue) && (MAJOR_EVENT.test(title) || classifyEventType(e) === "sports")) {
    return "major"
  }
  // Ticket links at a large venue still promote to major. This is the marquee case the engine
  // exists for ("BTS World Tour" at AT&T Stadium) and a test pins it.
  if (LARGE_VENUE.test(venue) && ticketed) return "major"
  // A headline event anywhere, if there is any corroboration that tickets are on sale.
  if (MAJOR_EVENT.test(title) && (MAJOR_VENUE.test(venue) || ticketed)) return "major"

  // FLOOR: a real event in a large-venue class is at least moderate. The venue class is a property
  // of the room and does not depend on what the scraper listed. Deliberately `moderate` and not
  // `major`: without a capacity we cannot tell a 2,000-seat pavilion from a 20,000-seat one, and
  // the catalog upgrade in annotate.ts promotes it to major once capacity is known.
  if (LARGE_VENUE.test(venue)) return "moderate"

  if (MODERATE_EVENT.test(title) || MODERATE_EVENT.test(venue) || ticketed) return "moderate"
  return "minor"
}

// ── Event TYPE classifier (Events source migration · P0 step 7) ─────────────
// A CORROBORATING fallback: a grounded source returns the closed-enum type directly;
// for the DataForSEO path (and as a backstop when a grounded type is missing) we derive
// it from the title/venue. Ordered — first match wins; conservative → "other" when unsure.
// Pure + deterministic + unit-tested. Never keyed into a differential-build hash.
const TYPE_SPORTS = /\b(nfl|nba|mlb|nhl|mls|ncaa|fifa|game|match|vs\.?|versus|playoff|championship|tournament|baseball|basketball|football|hockey|soccer|rodeo|nascar|grand prix|formula 1|speedway|monster jam|wrestling|boxing|ufc)\b/i
const TYPE_RACE = /\b(marathon|half[- ]?marathon|10k|5k|fun run|road race|triathlon|bike race|cycling|relay race|criterium)\b/i
const TYPE_CONCERT = /\b(concert|tour|live music|symphony|orchestra|dj set|acoustic|recital|in concert)\b/i
const TYPE_FESTIVAL = /\b(festival|fest|carnival|state fair|county fair|block party)\b/i
const TYPE_CONFERENCE = /\b(conference|convention|summit|symposium|trade show|expo|conf\b)\b/i
const TYPE_THEATER = /\b(theater|theatre|broadway|musical|ballet|opera|comedy|stand[- ]?up|improv|play\b|the play)\b/i
const TYPE_FAMILY = /\b(circus|kids|children|family[- ]friendly|petting zoo|disney on ice|sesame)\b/i
const TYPE_COMMUNITY = /\b(parade|farmers?[- ]?market|craft fair|charity|fundraiser|community|holiday lighting|tree lighting)\b/i

export function classifyEventType(e: Pick<NormalizedEvent, "title" | "venue">): EventType {
  const hay = `${e.title ?? ""} ${e.venue?.name ?? ""}`
  if (TYPE_SPORTS.test(hay) || TYPE_RACE.test(hay)) return "sports"
  if (TYPE_CONCERT.test(hay)) return "concert"
  if (TYPE_FESTIVAL.test(hay)) return "festival"
  if (TYPE_CONFERENCE.test(hay)) return "conference"
  if (TYPE_THEATER.test(hay)) return "theater"
  if (TYPE_FAMILY.test(hay)) return "family"
  if (TYPE_COMMUNITY.test(hay)) return "community"
  return "other"
}

export function classifyEventRole(
  distanceMiles: number | null | undefined,
  magnitude: EventMagnitude,
  opts: { isRoute?: boolean; densityClass?: DensityClass | null } = {},
): EventRole {
  if (distanceMiles == null || Number.isNaN(distanceMiles)) return "ungeocoded"
  // R2: scale the foot/traffic ring by the TRUE density class. Unknown class → suburban,
  // i.e. the original PROXIMITY.footMiles / trafficMiles — byte-identical to today.
  const ring = proximityRingFor(opts.densityClass)
  // Route events get a looser corridor role: a closure passes the block even when the
  // anchor venue is up to a few miles away. It never claims "draw"; only access disruption.
  if (opts.isRoute) {
    return distanceMiles <= ring.trafficMiles ? "route_corridor" : "out_of_area"
  }
  if (distanceMiles <= ring.footMiles) return "local_foot"
  if (distanceMiles <= ring.trafficMiles) return "local_traffic"
  if (magnitude === "major") return "metro_hook"
  return "out_of_area"
}

/** Events allowed to drive DEMAND reasoning (prepare/staff/traffic claims). */
export function isLocalDemand(role: EventRole): boolean {
  return role === "local_foot" || role === "local_traffic"
}
