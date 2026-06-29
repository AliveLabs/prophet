// The Pass — honest mapping from the real events snapshot onto Concept A's kit.
// Pure functions only (no JSX) so this stays server-safe. Nothing here invents
// covers/$/POS numbers: everything is distance (geocoded), magnitude (heuristic),
// proximity %, and "estimated" demand-window framing — labeled as such in the UI.

import type { NormalizedEvent } from "@/lib/events/types"
import type { TkFamily, TkConfidenceLevel } from "@/components/ticket"

/* ── Event "type" we surface as a family-tinted chip ─────────────────────────
   The kit only tints 5 families; we collapse an event's role/magnitude honestly:
   • a matched-competitor event → `competitive` (it's about the set)
   • a route/street-closure event → `grassroots` (community / on-the-ground)
   • a high-draw marquee event → `menu` (teal "opportunity" tint — a demand spike to prep for)
   • everything else nearby → `social` (gold — neighborhood happenings)            */
export function eventFamily(ev: NormalizedEvent, isMatched: boolean): TkFamily {
  if (isMatched) return "competitive"
  if (ev.isRouteEvent || ev.role === "route_corridor") return "grassroots"
  if (ev.magnitude === "major") return "menu"
  return "social"
}

/** Short, honest chip label for the event family. */
export function eventChipLabel(ev: NormalizedEvent, isMatched: boolean): string {
  if (isMatched) return "Competitor tie-in"
  if (ev.isRouteEvent || ev.role === "route_corridor") return "Street closure"
  if (ev.magnitude === "major") return "Major draw"
  if (ev.magnitude === "moderate") return "Moderate draw"
  return "Nearby"
}

/* ── Confidence: how sure are we this event matters to THIS restaurant? ───────
   Grounded honestly in venue-identity confidence + how close it is. We never
   claim "high" off a raw scrape: only a coordinate/place-id match or a tight
   radius earns it.                                                              */
export function eventConfidence(ev: NormalizedEvent): TkConfidenceLevel {
  const resolved =
    ev.venueConfidence === "matched_place_id" || ev.leagueValidated === true
  const near = typeof ev.distanceMiles === "number" && ev.distanceMiles <= 0.75
  const moderate = typeof ev.distanceMiles === "number" && ev.distanceMiles <= 2
  if (resolved && near) return "high"
  if (resolved || near || moderate) return "medium"
  return "directional"
}

/* ── Proximity fill (0–100) for the TkRangeBar density/draw meter. ───────────
   Closer = fuller. 0 mi → 100, 3+ mi → ~10. Pure distance, no demand fabrication. */
export function proximityFill(distanceMiles?: number | null): number {
  if (typeof distanceMiles !== "number" || Number.isNaN(distanceMiles)) return 0
  const clamped = Math.max(0, Math.min(3, distanceMiles))
  return Math.round(100 - (clamped / 3) * 90) // 0mi→100, 3mi→10
}

/** Human distance label, e.g. "0.4 mi away" / "Distance pending". */
export function distanceLabel(distanceMiles?: number | null): string {
  if (typeof distanceMiles !== "number" || Number.isNaN(distanceMiles)) {
    return "Distance pending"
  }
  if (distanceMiles < 0.1) return "Next door"
  return `${distanceMiles.toFixed(1)} mi away`
}

/* ── Pick the lead event for the hero: the nearest, highest-draw, resolved one.
   We prefer something we can stand behind (resolved venue), then proximity,
   then magnitude. Returns null when nothing clears a useful bar.               */
const MAG_RANK: Record<NonNullable<NormalizedEvent["magnitude"]>, number> = {
  major: 3,
  moderate: 2,
  minor: 1,
}
export function pickLeadEvent(events: NormalizedEvent[]): NormalizedEvent | null {
  const scored = events
    .map((ev) => {
      const dist = typeof ev.distanceMiles === "number" ? ev.distanceMiles : 99
      const mag = ev.magnitude ? MAG_RANK[ev.magnitude] : 0
      const resolved =
        ev.venueConfidence === "matched_place_id" || ev.leagueValidated === true
          ? 1
          : 0
      // lower distance is better; higher mag/resolved is better
      const score = (resolved ? 1000 : 0) + mag * 100 + Math.max(0, 60 - dist * 10)
      return { ev, score, dist }
    })
    // only lead with something within a believable trade-area radius
    .filter((s) => s.dist <= 5 || s.ev.magnitude === "major")
    .sort((a, b) => b.score - a.score)
  return scored[0]?.ev ?? null
}

/* ── Severity (insight row) → kit confidence, honestly. ──────────────────── */
export function severityToConfidence(severity?: string | null): TkConfidenceLevel {
  if (severity === "critical" || severity === "warning") return "high"
  if (severity === "info" || severity === "notice") return "medium"
  return "directional"
}
