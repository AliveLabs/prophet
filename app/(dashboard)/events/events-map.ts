// The Pass — honest mapping from the real events snapshot onto Concept A's kit.
// Pure functions only (no JSX) so this stays server-safe. Nothing here invents
// covers/$/POS numbers: everything is distance (geocoded), magnitude (heuristic),
// proximity %, and "estimated" demand-window framing — labeled as such in the UI.

import type { NormalizedEvent } from "@/lib/events/types"
import type { TkFamily, TkConfidenceLevel, TkImpactLevel } from "@/components/ticket"

/* ── Wall-clock time parsing (ALT-212) ───────────────────────────────────────
   The event feed gives a LOCAL wall-clock time (e.g. the venue's "11:00"), but
   the source serializes it with a spurious "+00:00"/"Z" offset. Passing that to
   `new Date(...).getHours()` / `toLocaleTimeString()` re-projects it into the
   SERVER's timezone (UTC on Vercel), which shifted the rendered time several
   hours from the stated kickoff — the card said "11 AM" while the timeline bar
   started at "4 PM".

   Fix: read the hour/minute straight off the string's wall-clock, ignoring the
   timezone designator, and use the SAME parse for the card label AND the bar.
   `authoritativeLocalStart` (validated fixtures, "YYYY-MM-DD HH:MM") is parsed
   identically. Returns null when there's no parseable time. */
export function eventLocalHour(ev: NormalizedEvent): number | null {
  const raw = ev.authoritativeLocalStart ?? ev.startDatetime
  const parsed = parseWallClock(raw)
  return parsed ? parsed.hour + parsed.minute / 60 : null
}

/** The event's LOCAL calendar date as "YYYY-MM-DD", read straight off the
 *  wall-clock string so it matches the forecast day keys regardless of server
 *  timezone (same reason as `eventLocalHour` — never re-project through Date()).
 *  Returns null when there's no parseable date. Used to line events up onto the
 *  weather composite's day strip. */
export function eventLocalDate(ev: NormalizedEvent): string | null {
  const raw = ev.authoritativeLocalStart ?? ev.startDatetime
  if (!raw) return null
  const m = LOCAL_DATE_RE.exec(raw)
  return m ? m[1] : null
}

const LOCAL_DATE_RE = /^(\d{4}-\d{2}-\d{2})/
const WALL_CLOCK_RE = /[T ](\d{1,2}):(\d{2})/

/** Pull {hour, minute} from a wall-clock datetime string, ignoring any timezone
 *  offset so the value is the same regardless of where the code runs. */
export function parseWallClock(
  iso: string | null | undefined,
): { hour: number; minute: number } | null {
  if (!iso) return null
  // Match "...THH:MM" or "... HH:MM" (date separator may be 'T' or a space).
  const m = WALL_CLOCK_RE.exec(iso)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/** Human 12-hour label from the wall-clock, e.g. "11:00 AM". Server-TZ-safe.
 *  Returns "" when no parseable time. */
export function eventTimeLabel(iso: string | null | undefined): string {
  const wc = parseWallClock(iso)
  if (!wc) return ""
  const period = wc.hour >= 12 ? "PM" : "AM"
  let h12 = wc.hour % 12
  if (h12 === 0) h12 = 12
  const mm = wc.minute.toString().padStart(2, "0")
  return `${h12}:${mm} ${period}`
}

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

/* ── Short badge label for the weather composite's day strip ──────────────────
   Concept A floats a tiny rust badge over an event day ("Game · AT&T"). We keep
   it copy-safe: prefer a VALIDATED / catalog venue name (never the raw scraped
   string once a validated name exists), trimmed short; otherwise a draw-class
   word. Distance/covers are never claimed here — it's just a "something's on"
   flag the operator can tap through to the Events page for. */
export function eventStripLabel(ev: NormalizedEvent): string {
  const venue =
    ev.validatedVenueName ??
    ev.catalogVenueName ??
    (ev.venueConfidence === "matched_place_id" ? ev.venue?.name : null) ??
    null
  if (venue) {
    const trimmed = venue.length > 16 ? `${venue.slice(0, 15).trimEnd()}…` : venue
    return trimmed
  }
  if (ev.isRouteEvent || ev.role === "route_corridor") return "Street event"
  if (ev.magnitude === "major") return "Major draw"
  if (ev.magnitude === "moderate") return "Event"
  return "Event"
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

/* ── Severity (insight row) → kit impact (ALT-289) ───────────────────────────
   The events insight rows carry the same `severity` field the confidence mapping
   above already reads (critical/warning/info/notice) — it's the same honest proxy
   the insights surfaces key their impact tag off of (see insights-map.ts
   `insightImpactLevel`). Mirrored here so an event insight's impact tag agrees
   with the rest of the app's convention. */
export function eventInsightImpactLevel(severity?: string | null): TkImpactLevel {
  if (severity === "critical") return "high"
  if (severity === "warning") return "medium"
  return "low"
}

/* ── In-trade-area gate (ALT-209 / ALT-215) ──────────────────────────────────
   The snapshot stores EVERY event the sweep returned, including ones far outside
   the restaurant's trade area (metro-wide marquees + distant noise). The page
   must only surface events inside the largest relevance bubble (~5mi), so the
   "events nearby" count and the rendered list agree.

   We gate on the pipeline's ROLE, which already encodes the density-scaled
   distance ring (local_foot ≤ foot ring, local_traffic ≤ traffic ring,
   route_corridor = a street closure within the traffic ring). We deliberately
   EXCLUDE:
     • metro_hook  — far + major; a marketing tie-in, never "nearby"
     • out_of_area — far + minor
     • ungeocoded  — no measured distance, so we can't claim it's nearby
   Pre-geo snapshots (no role on any event) fall back to a hard distance cap so
   older snapshots still render something sensible.                            */
export const TRADE_AREA_MAX_MILES = 5

const IN_AREA_ROLES = new Set<NonNullable<NormalizedEvent["role"]>>([
  "local_foot",
  "local_traffic",
  "route_corridor",
])

export function isInTradeArea(ev: NormalizedEvent): boolean {
  if (ev.role) return IN_AREA_ROLES.has(ev.role)
  // Fallback for snapshots captured before geo-annotation wrote a role: keep only
  // events with a measured distance inside the largest bubble.
  return typeof ev.distanceMiles === "number" && ev.distanceMiles <= TRADE_AREA_MAX_MILES
}

/* ── Deep-link picker (ALT-210) ──────────────────────────────────────────────
   Land on the most specific real destination we have, not a generic
   bureau/convention-center landing page. Order of preference:
     1. a real ticket/event URL (information_and_tickets) — these point at the
        actual event sale/detail page
     2. the event's own url, when it's a deep path (has a path beyond "/"),
        i.e. not a bare homepage
     3. any ticket/info link at all — still event-specific, beats a homepage
     4. the venue's OFFICIAL website (`venueWebsite`), resolved at the data layer
        from the geocoded venue's Google Place. A real venue URL beats landing on
        a generic bureau homepage when the scrape gave us nothing event-specific.
     5. the event's url as a last resort (typically the bare bureau homepage)
   We never fabricate a URL — `venueWebsite` is only ever a validated http(s) URL
   Google returned for the venue; if we have nothing real, we return what we have. */
const TICKET_HINT = /(ticket|event|tickets|seats|buy|rsvp|register)/i

export function pickEventDeepLink(ev: NormalizedEvent): string | null {
  const tickets = ev.ticketsAndInfo ?? []
  // 1. Prefer a ticket/event link whose title or url signals it's the real detail page.
  const hinted = tickets.find(
    (t) => t.url && (TICKET_HINT.test(t.title ?? "") || TICKET_HINT.test(t.description ?? "") || TICKET_HINT.test(t.url)),
  )
  if (hinted?.url) return hinted.url
  // 2. Any ticket/info link at all is more specific than a bureau page.
  const firstTicket = tickets.find((t) => t.url)?.url
  // 3. The event's own url, preferring a deep path over a bare homepage.
  const ownUrl = ev.url
  const ownIsDeep = ownUrl ? hasDeepPath(ownUrl) : false
  if (ownIsDeep) return ownUrl ?? null
  if (firstTicket) return firstTicket
  // 4. The venue's official site — a real destination over a bare bureau homepage.
  if (ev.venueWebsite) return ev.venueWebsite
  return ownUrl ?? null
}

/** True when the URL has a path/query beyond a bare homepage ("/"), i.e. it
 *  points one level deeper than a domain landing page. */
function hasDeepPath(url: string): boolean {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, "")
    return path.length > 0 || u.search.length > 0
  } catch {
    return false
  }
}

/* ── Impact label (ALT-214) ──────────────────────────────────────────────────
   The bars (proximity meter / confidence pips) must never stand alone — always
   pair them with a plain-language impact word so the read isn't ambiguous.
   Grounded in the event's role + magnitude (honest, no covers/$):
     • local_foot          → "High impact"   (walk-in distance)
     • local_traffic/route → "Medium impact" (drive/traffic distance)
     • everything else     → "Low impact"
   Major draws inside the area never read below medium.                         */
export type ImpactLevel = "high" | "medium" | "low"

export function eventImpact(ev: NormalizedEvent): ImpactLevel {
  if (ev.role === "local_foot") return "high"
  if (ev.role === "local_traffic" || ev.role === "route_corridor") return "medium"
  if (ev.magnitude === "major") return "medium"
  // distance fallback for pre-geo snapshots
  if (typeof ev.distanceMiles === "number") {
    if (ev.distanceMiles <= 0.5) return "high"
    if (ev.distanceMiles <= TRADE_AREA_MAX_MILES) return "medium"
  }
  return "low"
}

const IMPACT_TEXT: Record<ImpactLevel, string> = {
  high: "High impact",
  medium: "Medium impact",
  low: "Low impact",
}

export function impactLabel(ev: NormalizedEvent): string {
  return IMPACT_TEXT[eventImpact(ev)]
}
