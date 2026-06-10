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

export const PROXIMITY = {
  footMiles: 0.5,
  trafficMiles: 3.0, // Bryan: "5 or less, maybe even 3 or less" — start strict
} as const

export type EventMagnitude = "major" | "moderate" | "minor"
export type EventRole = "local_foot" | "local_traffic" | "metro_hook" | "out_of_area" | "ungeocoded"

// Venue-class + league/event keywords. Conservative: "major" needs a stadium-class
// venue or a pro-league/headline keyword — metro hooks are the exception, not the rule.
const MAJOR_VENUE = /\b(stadium|arena|speedway|amphitheat|fairgrounds|coliseum|bowl|field house|center)\b/i
const MAJOR_EVENT = /\b(nfl|nba|mlb|nhl|mls|ncaa|playoff|championship|final|cup|monster jam|rodeo|state fair)\b/i
// no bare "tour" — a club tour is small; stadium tours qualify via MAJOR venue+ticketing
const MODERATE_EVENT = /\b(festival|fest|concert|expo|convention|marathon|parade)\b/i

export function classifyEventMagnitude(e: Pick<NormalizedEvent, "title" | "venue" | "ticketsAndInfo">): EventMagnitude {
  const venue = e.venue?.name ?? ""
  const title = e.title ?? ""
  const ticketed = (e.ticketsAndInfo?.length ?? 0) >= 2
  if (MAJOR_EVENT.test(title) && (MAJOR_VENUE.test(venue) || ticketed)) return "major"
  if (MAJOR_VENUE.test(venue) && ticketed) return "major"
  if (MODERATE_EVENT.test(title) || MODERATE_EVENT.test(venue) || ticketed) return "moderate"
  return "minor"
}

export function classifyEventRole(distanceMiles: number | null | undefined, magnitude: EventMagnitude): EventRole {
  if (distanceMiles == null || Number.isNaN(distanceMiles)) return "ungeocoded"
  if (distanceMiles <= PROXIMITY.footMiles) return "local_foot"
  if (distanceMiles <= PROXIMITY.trafficMiles) return "local_traffic"
  if (magnitude === "major") return "metro_hook"
  return "out_of_area"
}

/** Events allowed to drive DEMAND reasoning (prepare/staff/traffic claims). */
export function isLocalDemand(role: EventRole): boolean {
  return role === "local_foot" || role === "local_traffic"
}
