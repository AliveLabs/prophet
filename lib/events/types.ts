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
