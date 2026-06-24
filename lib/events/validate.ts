// ---------------------------------------------------------------------------
// Events Validation Gate (P13 · R1) — VALIDATE-then-rank.
//
// THE BUG THIS FIXES: the engine mis-located + mis-dated a World Cup match because it
// trusted a SCRAPED event TITLE and geocoded the title text. Result: a match claimed to be
// "nearby" a restaurant it wasn't near, on a date it wasn't on, with copy built from the raw
// scraped string.
//
// THE GATE: before any event is allowed to drive demand reasoning, it must resolve to a
// STABLE VENUE IDENTITY (via the coordinate-matched venue catalog), and — for SCHEDULED-LEAGUE
// events — be CROSS-CHECKED against an authoritative fixture schedule (WC2026 seed today,
// generalizable later). The gate emits a small, closed set of VALIDATED FIELDS that downstream
// copy is templated from. The raw scraped title is NEVER surfaced into customer copy.
//
//   venue_confidence:
//     matched_place_id  — geocoded onto a known catalog venue (rebrand-proof). Strongest.
//     geocoded_only     — geocoded to a point but not a catalog venue. May claim local by distance.
//     unresolved        — no geocode/venue fix. MAY NEVER claim local impact → capped at metro_hook.
//
//   For a scheduled-league listing whose venue IS in the fixture schedule:
//     • match at (venueId, localDate) found  → VALIDATED (carry fixtureRef + authoritativeLocalStart).
//     • venue in schedule but NO match that date → DATE MISMATCH → downgrade to metro_hook.
//     • listing venue not resolvable to a fixture venue → VENUE MISMATCH → downgrade to metro_hook.
//
// Pure + deterministic + unit-tested. No network, no model.
// ---------------------------------------------------------------------------

import type { NormalizedEvent } from "./types"
import type { EventRole } from "./relevance"
import type { CatalogVenue } from "./venue-catalog"
import { matchEventToCatalog, normalizeVenueName } from "./venue-catalog"
import type { FixtureIndex } from "./fixtures/loader"
import type { FixtureMatch } from "./fixtures/wc2026"

export type VenueConfidence = "matched_place_id" | "geocoded_only" | "unresolved"

/** Why a league listing failed its authoritative cross-check (for provenance/logging). */
export type ValidationDowngradeReason =
  | "unresolved_venue"
  | "league_venue_mismatch"
  | "league_date_mismatch"
  | null

/** The CLOSED set of validated fields downstream copy may template from. Anything NOT here
 *  (notably the raw scraped title) must never reach customer copy. */
export type ValidatedEventFields = {
  /** Canonical venue name — the catalog/fixture identity, NOT the scraped venue string. */
  canonicalVenue: string | null
  /** Stable venue identity (fixture venueId when league-resolved, else catalog placeId). */
  venueId: string | null
  /** Authoritative local start "YYYY-MM-DD HH:MM" from the fixture schedule when cross-checked,
   *  else the event's own ISO start when it survived as a non-league local event. */
  authoritativeLocalStart: string | null
  /** Provenance pointer to the authoritative source (e.g. "fifa-world-cup-2026:att-stadium:2026-06-17"). */
  fixtureRef: string | null
}

export type ValidatedEvent = {
  /** The underlying event (geo fields preserved; role may be downgraded below). */
  event: NormalizedEvent
  venueConfidence: VenueConfidence
  /** Possibly-downgraded role. `unresolved`/failed-cross-check events are capped at metro_hook. */
  role: EventRole
  /** True only when a scheduled-league listing passed the authoritative (venue+date) cross-check. */
  leagueValidated: boolean
  downgradeReason: ValidationDowngradeReason
  /** Validated fields — the ONLY strings copy may use. */
  fields: ValidatedEventFields
  /** Stable dedupe key: `${venueId|geocode}|${localDate}|${normalizedTitle}`. */
  dedupeKey: string
}

// Scheduled-league keywords — listings matching these MUST clear the authoritative cross-check
// to keep a local role. Conservative: covers the leagues we seed/intend to seed.
const SCHEDULED_LEAGUE = /\b(fifa|world cup|world cup 26|wc26|nfl|nba|mlb|nhl|mls|ncaa|premier league|la liga|champions league)\b/i

export function isScheduledLeagueTitle(title: string | null | undefined): boolean {
  return SCHEDULED_LEAGUE.test(title ?? "")
}

/** Local date (YYYY-MM-DD) of an event from its ISO start, else null. Uses the date PORTION of
 *  the ISO string directly (the events pipeline stores local-ish start datetimes), not UTC math,
 *  so a 20:00-local kickoff doesn't roll to the next UTC day. */
export function localDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** A title-derived key for dedupe (lowercased, whitespace-collapsed, punctuation-light). */
export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
}

/** Cap a role so it can never claim local foot/traffic impact. Preserves an existing
 *  metro_hook/out_of_area/route role; only demotes local_* → metro_hook. */
function capToMetroHook(role: EventRole | undefined): EventRole {
  if (role === "local_foot" || role === "local_traffic") return "metro_hook"
  return role ?? "ungeocoded"
}

/** Resolve the venue identity confidence for a single event. */
function resolveVenueConfidence(
  e: NormalizedEvent,
  catalog: CatalogVenue[],
): { confidence: VenueConfidence; canonicalVenue: string | null; venueId: string | null } {
  const lat = e.venue?.lat
  const lng = e.venue?.lng
  // Prefer the already-stamped catalog match (annotate.ts), else recompute from coords.
  if (e.catalogVenueName) {
    const matched = matchEventToCatalog(lat, lng, catalog)
    return {
      confidence: "matched_place_id",
      canonicalVenue: e.catalogVenueName,
      venueId: matched?.placeId ?? e.catalogVenueName,
    }
  }
  const matched = matchEventToCatalog(lat, lng, catalog)
  if (matched) {
    return { confidence: "matched_place_id", canonicalVenue: matched.name, venueId: matched.placeId ?? matched.name }
  }
  if (lat != null && lng != null && e.distanceMiles != null) {
    // Geocoded to a point but not onto a known venue: identity is the geocode itself.
    return { confidence: "geocoded_only", canonicalVenue: null, venueId: null }
  }
  return { confidence: "unresolved", canonicalVenue: null, venueId: null }
}

/** Look up a fixture venue id for an event by its venue/catalog NAME (rebrand-proof). */
function fixtureVenueIdFor(e: NormalizedEvent, fx: FixtureIndex): string | null {
  const candidates = [e.catalogVenueName, e.venue?.name].filter(Boolean) as string[]
  for (const name of candidates) {
    const id = fx.venueIdByName.get(normalizeVenueName(name))
    if (id) return id
  }
  return null
}

/** Cross-check a league listing against the authoritative fixture schedule. */
function crossCheckLeague(
  e: NormalizedEvent,
  fx: FixtureIndex,
): { validated: boolean; reason: ValidationDowngradeReason; match: FixtureMatch | null; fixtureVenueId: string | null; competitionId: string | null } {
  const fixtureVenueId = fixtureVenueIdFor(e, fx)
  if (!fixtureVenueId) {
    // The listing claims a league but its venue isn't a known host venue → can't be trusted local.
    return { validated: false, reason: "league_venue_mismatch", match: null, fixtureVenueId: null, competitionId: null }
  }
  const venue = fx.venuesById.get(fixtureVenueId)
  const localDate = localDateOf(e.startDatetime)
  if (!localDate) {
    return { validated: false, reason: "league_date_mismatch", match: null, fixtureVenueId, competitionId: venue?.competitionId ?? null }
  }
  const matches = fx.matchesByVenueDate.get(`${fixtureVenueId}|${localDate}`) ?? []
  if (matches.length > 0) {
    return { validated: true, reason: null, match: matches[0], fixtureVenueId, competitionId: venue?.competitionId ?? null }
  }
  // The venue is a host venue but no seeded match falls on this date. If the date is INSIDE the
  // tournament window, this is a venue we know but a pairing we didn't seed (e.g. a knockout) —
  // the venue resolves but we can't assert the exact match: treat as a date we can't confirm.
  return { validated: false, reason: "league_date_mismatch", match: null, fixtureVenueId, competitionId: venue?.competitionId ?? null }
}

/** Validate a single geo-annotated event against the venue catalog + fixture schedule.
 *  Pure; the caller dedupes across the batch. */
export function validateEvent(
  e: NormalizedEvent,
  catalog: CatalogVenue[],
  fx: FixtureIndex,
): ValidatedEvent {
  const { confidence, canonicalVenue, venueId } = resolveVenueConfidence(e, catalog)
  const localDate = localDateOf(e.startDatetime)
  const normTitle = normalizeTitle(e.title)
  const isLeague = isScheduledLeagueTitle(e.title)

  // ── Base role: an unresolved venue may NEVER claim local impact. ──
  let role: EventRole = e.role ?? "ungeocoded"
  let downgradeReason: ValidationDowngradeReason = null
  let leagueValidated = false
  let fields: ValidatedEventFields = {
    canonicalVenue,
    venueId,
    authoritativeLocalStart: null,
    fixtureRef: null,
  }

  if (confidence === "unresolved") {
    role = capToMetroHook(role)
    if (role === "metro_hook") downgradeReason = "unresolved_venue"
  }

  if (isLeague) {
    const xc = crossCheckLeague(e, fx)
    if (xc.validated && xc.match && xc.fixtureVenueId) {
      const venue = fx.venuesById.get(xc.fixtureVenueId)!
      leagueValidated = true
      // Authoritative fields ONLY — copy templated from these, never from e.title.
      fields = {
        canonicalVenue: venue.placeName,
        venueId: xc.fixtureVenueId,
        authoritativeLocalStart: `${xc.match.localDate} ${xc.match.localKickoff}`,
        fixtureRef: `${xc.competitionId}:${xc.fixtureVenueId}:${xc.match.localDate}`,
      }
      // A validated league venue is a known place; keep its local role unless it was unresolved
      // (it can't be — a fixture venue resolves by name). Preserve the geo-derived role.
      role = e.role ?? role
    } else {
      // Venue OR date mismatch on a league listing → can't be trusted as nearby demand.
      role = capToMetroHook(e.role ?? role)
      downgradeReason = xc.reason
    }
  } else if (confidence !== "unresolved") {
    // Non-league local event that resolved to a venue: surface its own start as the authoritative
    // local start (the validated field), still NOT the scraped title.
    fields = {
      canonicalVenue,
      venueId,
      authoritativeLocalStart: e.startDatetime ?? null,
      fixtureRef: null,
    }
  }

  const dedupeId = venueId ?? fields.venueId ?? (e.venue?.lat != null ? `geo:${e.venue.lat},${e.venue.lng}` : `uid:${e.uid}`)
  const dedupeKey = `${dedupeId}|${localDate ?? "no-date"}|${normTitle}`

  return { event: e, venueConfidence: confidence, role, leagueValidated, downgradeReason, fields, dedupeKey }
}

/** Validate a batch + DEDUPE by (venueId, localDate, normalizedTitle). On a duplicate, keep the
 *  one with the STRONGER signal (league-validated > matched_place_id > geocoded_only > unresolved).
 *  Returns events in input order (first surviving occurrence wins its slot). */
export function validateEvents(
  events: NormalizedEvent[],
  catalog: CatalogVenue[],
  fx: FixtureIndex,
): ValidatedEvent[] {
  const rank = (v: ValidatedEvent): number => {
    if (v.leagueValidated) return 3
    if (v.venueConfidence === "matched_place_id") return 2
    if (v.venueConfidence === "geocoded_only") return 1
    return 0
  }
  const byKey = new Map<string, ValidatedEvent>()
  const order: string[] = []
  for (const e of events) {
    const v = validateEvent(e, catalog, fx)
    const existing = byKey.get(v.dedupeKey)
    if (!existing) {
      byKey.set(v.dedupeKey, v)
      order.push(v.dedupeKey)
    } else if (rank(v) > rank(existing)) {
      byKey.set(v.dedupeKey, v) // keep the stronger; preserves the original slot
    }
  }
  return order.map((k) => byKey.get(k)!)
}

/** Events allowed to drive DEMAND reasoning after validation (local foot/traffic + corridor).
 *  Mirrors relevance.isLocalDemand but reads the POST-VALIDATION role. */
export function isValidatedLocalDemand(v: ValidatedEvent): boolean {
  return v.role === "local_foot" || v.role === "local_traffic" || v.role === "route_corridor"
}
