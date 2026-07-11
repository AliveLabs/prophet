// ---------------------------------------------------------------------------
// Normalize GROUNDED events → NormalizedEventsSnapshotV1
// (Events source migration · P0 step 3)
//
// Maps the grounded adapter's GroundedEvent[] onto the SAME NormalizedEvent shape the
// DataForSEO path produces, so everything downstream (geo annotate, validate, insights,
// the events UI, the skills) is source-agnostic and needs no changes.
//
// Deliberate choices:
//   • source stays "dataforseo_google_events" (downstream decision #1 — zero read-path
//     churn); `origin: "grounded"` records the true provenance for merge + shadow-compare.
//   • uid uses computeStableEventUid (venue + LOCAL DATE + title-stem, no time/url) so a
//     generative source's run-to-run variance doesn't mint a new uid daily → protects
//     dedup, event_matches, is_new, and differential-build reuse.
//   • DATES are coerced by normalizeGroundedDate; an event whose date is AMBIGUOUS is
//     DROPPED (never mis-dated) — this migration exists to kill wrong dates, not add them.
//   • magnitude is seeded off the `ticketed` boolean here; annotateEventsGeo overrides it
//     from the venue catalog's measured capacity (the authoritative signal) post-geocode.
// ---------------------------------------------------------------------------

import { computeStableEventUid } from "./hash"
import { normalizeGroundedDate } from "./date-normalize"
import { normalizeWebsiteUrl } from "./geo"
import { buildSummary } from "./normalize"
import { classifyEventType } from "./relevance"
import type { GroundedEvent } from "@/lib/providers/gemini/google-events"
import type {
  NormalizedEvent,
  NormalizedEventsSnapshotV1,
  EventsQuery,
  EventTicketInfo,
} from "./types"

/** Strip a Vertex/Gemini grounding-redirect wrapper, then validate as http(s). Grounded JSON
 *  usually carries real URLs, but occasionally a redirect wrapper leaks through. */
export function cleanGroundedUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  let url = raw.trim()
  // vertexaisearch.cloud.google.com/grounding-api-redirect/... → unwrap a nested ?url= if present.
  if (/vertexaisearch\.cloud\.google\.com|grounding-api-redirect/i.test(url)) {
    try {
      const inner = new URL(url).searchParams.get("url")
      if (inner) url = inner
      else return undefined // an opaque redirect we can't unwrap is not a usable deep link
    } catch {
      return undefined
    }
  }
  return normalizeWebsiteUrl(url) ?? undefined
}

function extractDomain(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

function mapTickets(e: GroundedEvent): EventTicketInfo[] | undefined {
  const tickets: EventTicketInfo[] = []
  const ticketUrl = cleanGroundedUrl(e.ticketUrl)
  if (ticketUrl) {
    tickets.push({ title: "Tickets", description: "TICKETS", url: ticketUrl, domain: extractDomain(ticketUrl) })
  }
  const officialUrl = cleanGroundedUrl(e.officialUrl)
  if (officialUrl && officialUrl !== ticketUrl) {
    tickets.push({ title: "More info", description: "MORE INFO", url: officialUrl, domain: extractDomain(officialUrl) })
  }
  return tickets.length ? tickets : undefined
}

/**
 * Normalize grounded events into a snapshot. Events with an unresolvable date are dropped.
 * `queries` is carried through for provenance; `horizon` mirrors the DataForSEO snapshot field.
 */
export function normalizeGroundedEvents(
  grounded: GroundedEvent[],
  opts: { queries: EventsQuery[]; horizon?: "week" | "weekend" | "month" } = { queries: [] },
): NormalizedEventsSnapshotV1 {
  const seenUids = new Set<string>()
  const events: NormalizedEvent[] = []

  for (const g of grounded) {
    const startDatetime = normalizeGroundedDate(g.startDatetime)
    if (!startDatetime) continue // ambiguous/unparseable date → DROP (never mis-date)
    const endDatetime = normalizeGroundedDate(g.endDatetime ?? null)

    const venueName = g.venue?.name?.trim() || undefined
    const venueAddress = g.venue?.address?.trim() || undefined

    const uid = computeStableEventUid({ title: g.title, startDatetime, venueName, venueAddress })
    if (seenUids.has(uid)) continue
    seenUids.add(uid)

    const tickets = mapTickets(g)
    const ticketed = g.ticketed || (tickets?.length ?? 0) > 0

    events.push({
      uid,
      title: g.title,
      startDatetime,
      endDatetime: endDatetime ?? null,
      displayedDates: null,
      venue: venueName || venueAddress ? { name: venueName, address: venueAddress } : undefined,
      ticketsAndInfo: tickets,
      // Seed magnitude off `ticketed` (annotate overrides from measured catalog capacity).
      magnitude: ticketed ? "moderate" : "minor",
      type: g.type ?? classifyEventType({ title: g.title, venue: { name: venueName } }),
      origin: "grounded",
      source: "dataforseo_google_events",
      keyword: "grounded",
      dateRange: opts.horizon ?? "month",
    })
  }

  return {
    version: "1.0",
    capturedAt: new Date().toISOString(),
    horizon: opts.horizon ?? "month",
    queries: opts.queries,
    events,
    summary: buildSummary(events),
  }
}
