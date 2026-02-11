// ---------------------------------------------------------------------------
// Hashing utilities for Local Events Intelligence
// ---------------------------------------------------------------------------

import { createHash } from "crypto"
import type { NormalizedEventsSnapshotV1 } from "./types"

// ---------------------------------------------------------------------------
// Canonicalization helpers
// ---------------------------------------------------------------------------

function canonicalize(str: string | undefined | null): string {
  if (!str) return ""
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // strip punctuation
    .replace(/\s+/g, " ") // collapse whitespace
    .trim()
}

function stripQueryParams(url: string | undefined | null): string {
  if (!url) return ""
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.hostname}${u.pathname}`
  } catch {
    return url ?? ""
  }
}

// ---------------------------------------------------------------------------
// Event UID – stable hash for deduplication + diff stability
// ---------------------------------------------------------------------------

export function computeEventUid(input: {
  title?: string
  startDatetime?: string | null
  displayedDates?: string | null
  venueName?: string
  venueAddress?: string
  url?: string
}): string {
  // Primary: title + startDatetime + venue + url
  const hasStructuredTime = !!input.startDatetime
  const hasVenue = !!(input.venueName || input.venueAddress)

  let payload: string

  if (hasStructuredTime && hasVenue) {
    payload = [
      canonicalize(input.title),
      input.startDatetime ?? "",
      canonicalize(input.venueName),
      canonicalize(input.venueAddress),
      stripQueryParams(input.url),
    ].join("|")
  } else {
    // Fallback: title + displayedDates + url
    payload = [
      canonicalize(input.title),
      input.displayedDates ?? input.startDatetime ?? "",
      stripQueryParams(input.url),
    ].join("|")
  }

  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

// ---------------------------------------------------------------------------
// Snapshot diff_hash – detects meaningful changes across snapshots
// ---------------------------------------------------------------------------

export function computeEventsSnapshotDiffHash(
  snapshot: NormalizedEventsSnapshotV1
): string {
  // Hash only "meaningful change" fields
  const eventFingerprints = snapshot.events
    .map((ev) => ({
      uid: ev.uid,
      startDatetime: ev.startDatetime ?? null,
      venueName: ev.venue?.name ?? null,
      venueAddress: ev.venue?.address ?? null,
      url: ev.url ?? null,
    }))
    .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))

  const payload = {
    events: eventFingerprints,
    summary: {
      totalEvents: snapshot.summary.totalEvents,
      byDate: snapshot.summary.byDate,
    },
  }

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
}
