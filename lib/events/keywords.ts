// ---------------------------------------------------------------------------
// Event query plan (Events Impact Engine · L1)
//
// Replaces the hardcoded single { keyword: "events" } query. Google Events ranks
// generic "events" toward local club/music listings, so a stadium mega-event sits
// below the depth-10 cutoff and is never fetched. The fix: probe DataForSEO BY the
// names of the marquee venues we cataloged near this restaurant (proven to rank
// the buried match to the top), while keeping a generic "events" net for the long
// tail — all WITHIN the existing per-run query budget (no extra DataForSEO cost).
//
// The top venue probe is STABLE per location (the in-ring stadium is probed every
// run, never rotated away) so recall has no per-day hole. Only the optional
// category net rotates to fill leftover budget. Pure + deterministic (testable).
// ---------------------------------------------------------------------------

import { isMajorCapacity, type CatalogVenue } from "./venue-catalog"

export type EventDateRange = "week" | "weekend" | "month"
export type EventQueryDef = { keyword: string; dateRange: EventDateRange }

const LOCAL_PROBE_MILES = 3
const STADIUM_PROBE_MILES = 15

// Rotated fallback keywords for when there's no marquee venue to probe. Beyond the
// generic "events" net these target high-draw categories the generic feed buries —
// crucially WEEKDAY sports/concerts: Thursday/Monday concerts, Monday/Wednesday-night
// football, etc. all move restaurant demand, so the old "weekend"-only net missed
// most of them. Daily cadence cycles the list; everything runs on the "week" horizon.
const FALLBACK_KEYWORDS = ["concert", "sports", "game", "festival", "comedy", "marathon", "parade"]

/** Catalog venues worth a dedicated name probe: anything in the local ring (≤3mi)
 *  OR a big-capacity venue within the wider ring (≤15mi). Ranked biggest-first. */
export function selectProbeVenues(catalog: CatalogVenue[]): CatalogVenue[] {
  return catalog
    .filter((v) => {
      const d = v.distanceMi ?? Infinity
      if (d <= LOCAL_PROBE_MILES) return true
      return d <= STADIUM_PROBE_MILES && isMajorCapacity(v.capacityHigh)
    })
    .sort((a, b) => {
      const ca = a.capacityHigh ?? 0
      const cb = b.capacityHigh ?? 0
      if (cb !== ca) return cb - ca
      return (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity)
    })
}

/** Build the per-run query plan from the venue catalog, capped to the tier's
 *  query budget. Falls back to the generic "events" net when no catalog/venue
 *  exists (cold start, rural strip), so behavior degrades gracefully. */
export function buildEventQueryPlan(input: {
  catalog: CatalogVenue[]
  maxQueries: number
  dateKey: string
}): EventQueryDef[] {
  const { catalog, maxQueries, dateKey } = input
  if (maxQueries <= 0) return []

  const probeVenues = selectProbeVenues(catalog)

  // Priority-ordered candidates; we take the top `maxQueries`. The best venue
  // probe is FIRST so it's always covered (and uses the "month" horizon to span a
  // multi-week tournament). The generic net is second for long-tail safety.
  const candidates: EventQueryDef[] = []
  if (probeVenues[0]) candidates.push({ keyword: probeVenues[0].name, dateRange: "month" })
  // Broad net on the WEEK horizon (covers weekdays, not just the weekend).
  candidates.push({ keyword: "events", dateRange: "week" })
  if (probeVenues[1]) candidates.push({ keyword: probeVenues[1].name, dateRange: "month" })
  // Two rotated targeted nets so the fallback issues MORE than just "events" — catches
  // the weekday concerts/games the generic feed buries (chosen deterministically by date).
  const i = dayIndex(dateKey)
  candidates.push({ keyword: FALLBACK_KEYWORDS[i % FALLBACK_KEYWORDS.length], dateRange: "week" })
  candidates.push({ keyword: FALLBACK_KEYWORDS[(i + 1) % FALLBACK_KEYWORDS.length], dateRange: "week" })
  if (probeVenues[2]) candidates.push({ keyword: probeVenues[2].name, dateRange: "month" })

  const seen = new Set<string>()
  const plan: EventQueryDef[] = []
  for (const c of candidates) {
    const k = `${c.keyword.toLowerCase()}|${c.dateRange}`
    if (seen.has(k)) continue
    seen.add(k)
    plan.push(c)
    if (plan.length >= maxQueries) break
  }
  return plan
}

/** Deterministic day number from a YYYY-MM-DD key (no Date.now — rotation is
 *  reproducible and unit-testable). */
function dayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number)
  return (y || 0) * 372 + (m || 0) * 31 + (d || 0)
}
