// ---------------------------------------------------------------------------
// Hybrid event merge (Events source migration · P0 step 9)
//
// HYBRID posture: keep DataForSEO for RECALL/breadth (it fans out multi-venue probes and
// catches small nearby weekday events), add the grounded source for ACCURACY (correct dates
// + named marquee events). This merges the two normalized lists into one:
//   • matched pair (same venue + local date + title-stem) → GROUNDED identity wins
//     (title, type, date, venue name); DataForSEO fills breadth/enrichment (image, ticket
//     links, maps url, cid, displayedDates).
//   • grounded-only event → kept (accuracy the scrape missed).
//   • DataForSEO-only event → kept (breadth the grounded query didn't return).
//
// Grouping uses computeStableEventUid on BOTH sides so a DataForSEO event and its grounded
// twin collapse even though their stored `uid` schemes differ. Pure + deterministic.
// ---------------------------------------------------------------------------

import { computeStableEventUid } from "./hash"
import { buildSummary } from "./normalize"
import type { NormalizedEvent, NormalizedEventsSnapshotV1 } from "./types"

function stableKey(e: NormalizedEvent): string {
  return computeStableEventUid({
    title: e.title,
    startDatetime: e.startDatetime,
    venueName: e.venue?.name,
    venueAddress: e.venue?.address,
  })
}

/** Merge one grounded event (authoritative identity) with its DataForSEO twin (breadth). */
function mergePair(df: NormalizedEvent, grounded: NormalizedEvent): NormalizedEvent {
  const dfTickets = df.ticketsAndInfo ?? []
  return {
    ...df, // enrichment base: imageUrl, url, displayedDates, cid/featureId, capacity, geo, validation
    uid: grounded.uid, // the STABLE uid, so reuse holds when the grounded source drives identity
    title: grounded.title ?? df.title,
    type: grounded.type ?? df.type,
    startDatetime: grounded.startDatetime ?? df.startDatetime,
    endDatetime: grounded.endDatetime ?? df.endDatetime,
    venue: {
      ...df.venue,
      name: grounded.venue?.name ?? df.venue?.name,
      address: grounded.venue?.address ?? df.venue?.address,
    },
    // Prefer DataForSEO's ticket breadth (usually richer); fall back to the grounded link.
    ticketsAndInfo: dfTickets.length ? dfTickets : grounded.ticketsAndInfo,
    origin: "grounded",
  }
}

/**
 * Merge DataForSEO + grounded event lists. Grounded (+ merged) events lead; DataForSEO-only
 * events follow (breadth). Deduped by stable key.
 */
export function mergeNormalizedEvents(
  dataforseo: NormalizedEvent[],
  grounded: NormalizedEvent[],
): NormalizedEvent[] {
  const dfByKey = new Map<string, NormalizedEvent>()
  for (const e of dataforseo) {
    const k = stableKey(e)
    if (!dfByKey.has(k)) dfByKey.set(k, e) // first occurrence wins (mirrors normalize dedupe)
  }

  const out: NormalizedEvent[] = []
  const usedDfKeys = new Set<string>()
  const seen = new Set<string>()

  // 1. Grounded first (accuracy leads), merged with a DataForSEO twin when one exists.
  for (const g of grounded) {
    const k = stableKey(g)
    if (seen.has(k)) continue
    seen.add(k)
    const twin = dfByKey.get(k)
    if (twin) {
      usedDfKeys.add(k)
      out.push(mergePair(twin, g))
    } else {
      out.push(g)
    }
  }

  // 2. DataForSEO-only events (breadth the grounded query didn't surface).
  for (const e of dataforseo) {
    const k = stableKey(e)
    if (usedDfKeys.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push({ ...e, origin: e.origin ?? "dataforseo" })
  }

  return out
}

/** Merge two normalized snapshots into a hybrid snapshot (events merged, summary rebuilt). */
export function mergeEventSnapshots(
  dataforseo: NormalizedEventsSnapshotV1,
  grounded: NormalizedEventsSnapshotV1,
): NormalizedEventsSnapshotV1 {
  const events = mergeNormalizedEvents(dataforseo.events, grounded.events)
  return {
    version: "1.0",
    capturedAt: new Date().toISOString(),
    horizon: dataforseo.horizon,
    queries: [...dataforseo.queries, ...grounded.queries],
    events,
    summary: buildSummary(events),
  }
}
