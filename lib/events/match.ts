// ---------------------------------------------------------------------------
// Event ↔ Competitor matching engine (deterministic, explainable)
// ---------------------------------------------------------------------------

import type { NormalizedEvent, EventMatchRecord } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonicalize(str: string | undefined | null): string {
  if (!str) return ""
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function extractDomain(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function tokenize(str: string): string[] {
  return canonicalize(str)
    .split(/\s+/)
    .filter((t) => t.length > 2) // skip very short tokens like "st", "dr"
}

// ---------------------------------------------------------------------------
// Competitor shape expected by the matcher
// ---------------------------------------------------------------------------

export type MatchableCompetitor = {
  id: string
  name?: string | null
  address?: string | null
  website?: string | null
}

// ---------------------------------------------------------------------------
// Core matching
// ---------------------------------------------------------------------------

export function matchEventsToCompetitors(
  events: NormalizedEvent[],
  competitors: MatchableCompetitor[],
  options: { locationId: string; dateKey: string }
): EventMatchRecord[] {
  const matches: EventMatchRecord[] = []

  for (const event of events) {
    for (const comp of competitors) {
      // ------------------------------------------------------------------
      // Rule 1 – HIGH confidence: venue name == competitor name
      // ------------------------------------------------------------------
      if (event.venue?.name && comp.name) {
        const venueNorm = canonicalize(event.venue.name)
        const compNorm = canonicalize(comp.name)

        if (venueNorm && compNorm && venueNorm === compNorm) {
          matches.push(
            buildMatch(event, comp, options, "venue_name", "high", {
              venue_name: venueNorm,
              competitor_name: compNorm,
            }, 0.95)
          )
          continue // strongest match found, skip weaker rules
        }
      }

      // ------------------------------------------------------------------
      // Rule 2 – MEDIUM confidence: venue address contains competitor tokens
      // ------------------------------------------------------------------
      if (event.venue?.address && comp.address) {
        const venueAddr = canonicalize(event.venue.address)
        const compTokens = tokenize(comp.address)

        if (compTokens.length >= 2) {
          const matchedTokens = compTokens.filter((t) => venueAddr.includes(t))
          const matchRatio = matchedTokens.length / compTokens.length

          if (matchRatio >= 0.6) {
            matches.push(
              buildMatch(event, comp, options, "venue_address", "medium", {
                venue_address: venueAddr,
                competitor_address_tokens: compTokens.join(", "),
                matched_tokens: matchedTokens.join(", "),
                match_ratio: matchRatio.toFixed(2),
              }, Number((matchRatio * 0.8).toFixed(2)))
            )
            continue
          }
        }
      }

      // ------------------------------------------------------------------
      // Rule 3 – LOW confidence: domain match (event URL / ticket domains)
      // ------------------------------------------------------------------
      if (comp.website) {
        const compDomain = extractDomain(comp.website)
        if (!compDomain) continue

        const domainsToCheck: string[] = []
        const eventDomain = extractDomain(event.url)
        if (eventDomain) domainsToCheck.push(eventDomain)

        if (event.ticketsAndInfo) {
          for (const t of event.ticketsAndInfo) {
            const d = t.domain ?? extractDomain(t.url)
            if (d) domainsToCheck.push(d.replace(/^www\./, ""))
          }
        }

        const matched = domainsToCheck.find((d) => d === compDomain)
        if (matched) {
          matches.push(
            buildMatch(event, comp, options, "url_domain", "low", {
              event_domain: matched,
              competitor_domain: compDomain,
            }, 0.4)
          )
        }
      }
    }
  }

  return matches
}

// ---------------------------------------------------------------------------
// Match builder
// ---------------------------------------------------------------------------

function buildMatch(
  event: NormalizedEvent,
  comp: MatchableCompetitor,
  options: { locationId: string; dateKey: string },
  matchType: EventMatchRecord["match_type"],
  confidence: EventMatchRecord["confidence"],
  matchInputs: Record<string, string>,
  score: number
): EventMatchRecord {
  return {
    location_id: options.locationId,
    competitor_id: comp.id,
    date_key: options.dateKey,
    event_uid: event.uid,
    match_type: matchType,
    confidence,
    evidence: {
      event: {
        uid: event.uid,
        title: event.title,
        start: event.startDatetime,
        venue: event.venue,
        url: event.url,
      },
      competitor: {
        id: comp.id,
        name: comp.name ?? undefined,
        website: comp.website ?? undefined,
      },
      match_inputs: matchInputs,
      score,
    },
  }
}
