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
// STABLE event UID for a GROUNDED source (Events source migration · P0 step 4)
//
// A generative source varies its output run-to-run — a different phrasing, a time that
// drifts by 30 minutes, a URL that changes — so keying the uid off title+startDatetime+url
// (computeEventUid above) would mint a NEW uid every day for the SAME event. That churns
// dedup + event_matches, spams is_new, and — the reason this is a separate function —
// DEFEATS differential-build reuse. So the grounded uid is keyed only on the SEMANTICALLY
// stable fields: normalized(venue) + LOCAL DATE (no time) + title-stem (no url). Two runs
// that surface the same event on the same day at the same venue hash identically.
//
// Deliberately SEPARATE from computeEventUid so the DataForSEO path (which is already
// day-to-day stable off one scraped source) keeps its exact uids — zero churn on the live
// path, so the in-flight differential-build reuse is never perturbed.
// ---------------------------------------------------------------------------

/** Title with trailing edition noise stripped so "Spring Fest 2026" and "Spring Fest"
 *  collapse (the year is already captured by localDate). */
function titleStem(title: string | undefined | null): string {
  return canonicalize(title)
    .replace(/\b(19|20)\d{2}\b/g, "") // year (localDate carries it)
    .replace(/\b\d{1,3}(st|nd|rd|th)\b/g, "") // "5th annual"
    .replace(/\bannual\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function computeStableEventUid(input: {
  title?: string
  startDatetime?: string | null
  venueName?: string
  venueAddress?: string
}): string {
  const localDate = (input.startDatetime ?? "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? ""
  const payload = [
    titleStem(input.title),
    localDate,
    canonicalize(input.venueName) || canonicalize(input.venueAddress),
  ].join("|")
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
