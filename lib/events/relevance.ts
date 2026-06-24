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

import type { NormalizedEvent } from "./types"
import type { DensityClass } from "@/lib/local/census-density"

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
const MAJOR_VENUE = /\b(stadium|arena|speedway|amphitheat|fairgrounds|coliseum|bowl|field house|center)\b/i
const MAJOR_EVENT = /\b(nfl|nba|mlb|nhl|mls|ncaa|fifa|playoff|championship|final|cup|world cup|super bowl|grand prix|formula 1|monster jam|rodeo|state fair)\b/i
// no bare "tour" — a club tour is small; stadium tours qualify via MAJOR venue+ticketing
const MODERATE_EVENT = /\b(festival|fest|concert|expo|convention|marathon|parade)\b/i

// Route / street-closure events: not point venues — the route can pass the block from a
// "start venue" miles away. Detected by title so they're treated as access-disruption, not draw.
const ROUTE_EVENT = /\b(marathon|half[- ]?marathon|10k|5k|fun run|road race|grand prix|criterium|parade|street fest|bike race|cycling|triathlon|relay race)\b/i

export function isRouteEventTitle(title: string | null | undefined): boolean {
  return ROUTE_EVENT.test(title ?? "")
}

export function classifyEventMagnitude(e: Pick<NormalizedEvent, "title" | "venue" | "ticketsAndInfo">): EventMagnitude {
  const venue = e.venue?.name ?? ""
  const title = e.title ?? ""
  const ticketed = (e.ticketsAndInfo?.length ?? 0) >= 2
  if (MAJOR_EVENT.test(title) && (MAJOR_VENUE.test(venue) || ticketed)) return "major"
  if (MAJOR_VENUE.test(venue) && ticketed) return "major"
  if (MODERATE_EVENT.test(title) || MODERATE_EVENT.test(venue) || ticketed) return "moderate"
  return "minor"
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
