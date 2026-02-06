// ---------------------------------------------------------------------------
// Normalize raw DataForSEO event items into NormalizedEventsSnapshotV1
// ---------------------------------------------------------------------------

import { computeEventUid } from "./hash"
import type {
  DataForSEOEventItem,
  NormalizedEvent,
  NormalizedEventsSnapshotV1,
  EventsQuery,
  EventsSummary,
  EventVenue,
  EventTicketInfo,
} from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDomain(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function parseDateFromISO(iso: string | null | undefined): string | null {
  if (!iso) return null
  // best-effort YYYY-MM-DD extraction
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function mapVenue(
  locationInfo: DataForSEOEventItem["location_info"]
): EventVenue | undefined {
  if (!locationInfo) return undefined
  return {
    name: locationInfo.name ?? undefined,
    address: locationInfo.address ?? undefined,
    mapsUrl: locationInfo.url ?? undefined,
    cid: locationInfo.cid ?? undefined,
    featureId: locationInfo.feature_id ?? undefined,
  }
}

function mapTickets(
  raw: DataForSEOEventItem["information_and_tickets"]
): EventTicketInfo[] | undefined {
  if (!raw || !raw.length) return undefined
  return raw.map((t) => ({
    title: t.title ?? undefined,
    description: t.description ?? undefined,
    url: t.url ?? undefined,
    domain: t.domain ?? undefined,
  }))
}

// ---------------------------------------------------------------------------
// Main normalizer
// ---------------------------------------------------------------------------

export function normalizeEventsSnapshot(
  rawItemsByQuery: Array<{
    items: DataForSEOEventItem[]
    keyword: string
    dateRange: string
  }>,
  queries: EventsQuery[]
): NormalizedEventsSnapshotV1 {
  const seenUids = new Set<string>()
  const events: NormalizedEvent[] = []

  for (const batch of rawItemsByQuery) {
    for (const item of batch.items) {
      // Only process event_item types
      if (item.type && item.type !== "event_item") continue

      const venue = mapVenue(item.location_info)
      const startDatetime = item.event_dates?.start_datetime ?? null
      const endDatetime = item.event_dates?.end_datetime ?? null
      const displayedDates = item.event_dates?.displayed_dates ?? null
      const tickets = mapTickets(item.information_and_tickets)

      const uid = computeEventUid({
        title: item.title,
        startDatetime,
        displayedDates,
        venueName: venue?.name,
        venueAddress: venue?.address,
        url: item.url,
      })

      // Deduplicate across queries
      if (seenUids.has(uid)) continue
      seenUids.add(uid)

      events.push({
        uid,
        title: item.title ?? undefined,
        description: item.description ?? undefined,
        url: item.url ?? undefined,
        imageUrl: item.image_url ?? undefined,
        startDatetime,
        endDatetime,
        displayedDates,
        venue,
        ticketsAndInfo: tickets,
        source: "dataforseo_google_events",
        keyword: batch.keyword,
        dateRange: batch.dateRange,
      })
    }
  }

  // Build summary
  const summary = buildSummary(events)

  // Determine horizon from the first query
  const horizon = (queries[0]?.dateRange ?? "week") as
    | "week"
    | "weekend"
    | "month"

  return {
    version: "1.0",
    capturedAt: new Date().toISOString(),
    horizon,
    queries,
    events,
    summary,
  }
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(events: NormalizedEvent[]): EventsSummary {
  const byDate: Record<string, number> = {}
  const byVenueName: Record<string, number> = {}
  const byDomain: Record<string, number> = {}

  for (const ev of events) {
    // byDate
    const dateStr = parseDateFromISO(ev.startDatetime)
    if (dateStr) {
      byDate[dateStr] = (byDate[dateStr] ?? 0) + 1
    }

    // byVenueName
    if (ev.venue?.name) {
      const key = ev.venue.name.trim().toLowerCase()
      byVenueName[key] = (byVenueName[key] ?? 0) + 1
    }

    // byDomain (from event url + ticket domains)
    const eventDomain = extractDomain(ev.url)
    if (eventDomain) {
      byDomain[eventDomain] = (byDomain[eventDomain] ?? 0) + 1
    }
    if (ev.ticketsAndInfo) {
      for (const t of ev.ticketsAndInfo) {
        const d = t.domain ?? extractDomain(t.url)
        if (d) {
          const key = d.replace(/^www\./, "")
          byDomain[key] = (byDomain[key] ?? 0) + 1
        }
      }
    }
  }

  return {
    totalEvents: events.length,
    byDate,
    byVenueName,
    byDomain,
  }
}
