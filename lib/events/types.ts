// ---------------------------------------------------------------------------
// Local Events Intelligence – Type Definitions
// ---------------------------------------------------------------------------

/** Venue information extracted from a DataForSEO event_item.location_info */
export type EventVenue = {
  name?: string
  address?: string
  mapsUrl?: string
  cid?: string
  featureId?: string
  /** Geocoded venue position (Places searchText), set by the events pipeline. */
  lat?: number
  lng?: number
}

/** Ticket / info link extracted from information_and_tickets */
export type EventTicketInfo = {
  title?: string
  description?: string // e.g. "TICKETS", "MORE INFO"
  url?: string
  domain?: string
}

/** A single normalized event */
export type NormalizedEvent = {
  uid: string // stable hash (title + start + venue + url)
  title?: string
  description?: string
  url?: string
  imageUrl?: string

  startDatetime?: string | null // ISO from event_dates.start_datetime
  endDatetime?: string | null
  displayedDates?: string | null

  venue?: EventVenue

  ticketsAndInfo?: EventTicketInfo[]

  // ── Geo-relevance (Layer 1/2: set by the events pipeline post-normalization) ──
  /** Straight-line miles from the restaurant to the geocoded venue. */
  distanceMiles?: number | null
  /** Heuristic draw class (stadium/league keywords, ticketing). */
  magnitude?: "major" | "moderate" | "minor"
  /** Distance × magnitude → role. local_* may drive demand; metro_hook = marketing tie-in only;
   *  route_corridor = a street-closing route event (marathon/parade/race) near the restaurant. */
  role?: "local_foot" | "local_traffic" | "metro_hook" | "route_corridor" | "out_of_area" | "ungeocoded"

  /** Venue's OFFICIAL website, resolved by the events pipeline from the geocoded venue's Google
   *  Place `websiteUri` (ALT-210 data-layer follow-up). A real venue URL we can deep-link to when
   *  the scraped event only carried a generic bureau/convention-center landing page. Never
   *  fabricated — only ever a validated http(s) URL that Google returned for the venue. */
  venueWebsite?: string

  // ── Catalog match (set by annotateEventsGeo when the event's geocoded venue lands on a known
  //    marquee venue) — grounds magnitude + feeds the impact model's attendance estimate. ──
  /** Name of the cataloged venue this event matched (rebrand-proof; coordinate match). */
  catalogVenueName?: string
  capacityLow?: number | null
  capacityHigh?: number | null
  capacityConfidence?: "measured" | "prior"
  /** Route/street-closure event (marathon/parade/race) — not a point venue. */
  isRouteEvent?: boolean

  // ── Validation gate (set by lib/events/validate.ts → wired in the events pipeline) ──
  // The CLOSED set of validated fields that customer copy may template from. The raw scraped
  // `title`/`venue.name` are NEVER interpolated into copy once these are present.
  /** Venue-identity confidence: matched_place_id | geocoded_only | unresolved. */
  venueConfidence?: "matched_place_id" | "geocoded_only" | "unresolved"
  /** Canonical (catalog/fixture) venue name — replaces the scraped venue string in copy. */
  validatedVenueName?: string | null
  /** Authoritative local start "YYYY-MM-DD HH:MM" (fixtures) or ISO (resolved non-league). */
  authoritativeLocalStart?: string | null
  /** Provenance pointer to the authoritative fixture row (competition:venue:date). */
  fixtureRef?: string | null
  /** True only when a scheduled-league listing cleared the authoritative (venue+date) cross-check. */
  leagueValidated?: boolean

  source: "dataforseo_google_events"
  keyword: string
  dateRange: string
}

/** Aggregated summary counts */
export type EventsSummary = {
  totalEvents: number
  byDate: Record<string, number> // YYYY-MM-DD -> count
  byVenueName: Record<string, number>
  byDomain: Record<string, number>
}

/** Query metadata stored alongside the snapshot */
export type EventsQuery = {
  keyword: string
  locationName: string // "City,State,United States"
  dateRange: "week" | "weekend" | "month"
  depth: number
}

/** Top-level normalized snapshot stored in location_snapshots.raw_data */
export type NormalizedEventsSnapshotV1 = {
  version: "1.0"
  capturedAt: string // ISO
  horizon: "week" | "weekend" | "month"
  queries: EventsQuery[]
  events: NormalizedEvent[]
  summary: EventsSummary
}

// ---------------------------------------------------------------------------
// Event–Competitor match record (mirrors event_matches table row)
// ---------------------------------------------------------------------------

export type EventMatchRecord = {
  location_id: string
  competitor_id: string | null
  date_key: string
  event_uid: string
  match_type: "venue_name" | "venue_address" | "url_domain"
  confidence: "high" | "medium" | "low"
  evidence: {
    event: {
      uid: string
      title?: string
      start?: string | null
      venue?: EventVenue
      url?: string
    }
    competitor: {
      id: string
      name?: string
      website?: string
    }
    match_inputs: Record<string, string>
    score: number
  }
}

// ---------------------------------------------------------------------------
// DataForSEO raw response shapes (for internal use)
// ---------------------------------------------------------------------------

export type DataForSEOEventItem = {
  type?: string
  title?: string
  description?: string
  url?: string
  image_url?: string
  event_dates?: {
    start_datetime?: string
    end_datetime?: string
    displayed_dates?: string
  }
  location_info?: {
    name?: string
    address?: string
    url?: string
    cid?: string
    feature_id?: string
  }
  information_and_tickets?: Array<{
    type?: string
    title?: string
    description?: string
    url?: string
    domain?: string
  }>
}

export type DataForSEOEventsResponse = {
  tasks?: Array<{
    status_code?: number
    status_message?: string
    result?: Array<{
      keyword?: string
      items_count?: number
      items?: DataForSEOEventItem[]
    }>
  }>
}
