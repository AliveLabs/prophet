// ---------------------------------------------------------------------------
// Venue catalog — the detection spine (Events Impact Engine · L0)
//
// Built ONCE per location at onboarding (+ quarterly refresh) by sweeping Places
// searchNearby over a demand-venue taxonomy. The catalog drives two things:
//   1. L1 keyword probes — we probe DataForSEO BY venue name (+ aliases), so a
//      stadium mega-event that Google buries under generic "events" gets asked
//      for directly (the proven World Cup fix).
//   2. Magnitude grounding — when a fetched event geocodes onto a catalog venue,
//      it INHERITS that venue's capacity + a deterministic "major" upgrade, which
//      also fixes FIFA-style rebrands (physical "AT&T Stadium" ↔ "Dallas Stadium")
//      that a title regex can't catch.
//
// Capacity is best-effort: a measured number (Wikidata P1083) when available, else
// a venue-type prior RANGE. We always carry the LOW end + a confidence flag so the
// downstream impact model never fabricates a precise headcount.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchNearbyPlaces } from "@/lib/places/google"
import { haversineMiles } from "./geo"

export type CapacityConfidence = "measured" | "prior"

export type CatalogVenue = {
  placeId: string | null
  name: string
  primaryType: string | null
  lat: number | null
  lng: number | null
  distanceMi: number | null
  capacityLow: number | null
  capacityHigh: number | null
  capacityConfidence: CapacityConfidence
  aliases: string[]
}

// Threshold (people) at/above which a catalog venue makes a coincident event "major".
export const MAJOR_CAPACITY_THRESHOLD = 5000

// Coordinate-match tolerance: an event venue this close to a catalog venue is the
// SAME place (handles geocode jitter + rebranded names).
const MATCH_TOLERANCE_MI = 0.12 // ~0.12mi ≈ 200m

const M_PER_MILE = 1609.34

// ── Venue taxonomy: Places includedType → search ring + capacity prior range ──
// Big draws (stadium/arena/speedway/fair) are searched on a wide ring (a metro
// stadium 8mi away is still a metro_hook); neighborhood draws use a tight ring.
// Each type is its own searchNearby call (≤20 results) so no single category gets
// truncated. Unsupported/invalid types fail soft (try/catch in the sweep).
type TaxonomyEntry = {
  includedType: string
  radiusMi: number
  capLow: number
  capHigh: number
}

const VENUE_TAXONOMY: TaxonomyEntry[] = [
  { includedType: "stadium", radiusMi: 15, capLow: 18000, capHigh: 85000 },
  { includedType: "arena", radiusMi: 15, capLow: 8000, capHigh: 20000 },
  { includedType: "sports_complex", radiusMi: 15, capLow: 5000, capHigh: 20000 },
  { includedType: "amphitheatre", radiusMi: 15, capLow: 5000, capHigh: 25000 },
  { includedType: "convention_center", radiusMi: 8, capLow: 4000, capHigh: 30000 },
  { includedType: "performing_arts_theater", radiusMi: 5, capLow: 250, capHigh: 2800 },
  { includedType: "concert_hall", radiusMi: 5, capLow: 500, capHigh: 3000 },
  { includedType: "university", radiusMi: 8, capLow: 2000, capHigh: 15000 },
  { includedType: "amusement_park", radiusMi: 10, capLow: 4000, capHigh: 30000 },
  { includedType: "tourist_attraction", radiusMi: 3, capLow: 500, capHigh: 5000 },
  { includedType: "park", radiusMi: 3, capLow: 500, capHigh: 8000 },
  { includedType: "secondary_school", radiusMi: 3, capLow: 1500, capHigh: 8000 },
  { includedType: "primary_school", radiusMi: 2, capLow: 300, capHigh: 1500 },
]

// ── FIFA World Cup 2026 host-venue rebrands (sponsor rules drop corporate names).
// Keyed by a normalized physical-venue name → the event-time alias the listings use.
// General venue aliases also come from Wikidata enrichment; this covers the live case.
const KNOWN_ALIASES: Record<string, string[]> = {
  "at&t stadium": ["Dallas Stadium"],
  "sofi stadium": ["Los Angeles Stadium"],
  "metlife stadium": ["New York New Jersey Stadium"],
  "mercedes-benz stadium": ["Atlanta Stadium"],
  "levi's stadium": ["San Francisco Bay Area Stadium"],
  "lincoln financial field": ["Philadelphia Stadium"],
  "arrowhead stadium": ["Kansas City Stadium"],
  "nrg stadium": ["Houston Stadium"],
  "lumen field": ["Seattle Stadium"],
  "hard rock stadium": ["Miami Stadium"],
  "gillette stadium": ["Boston Stadium"],
  "bc place": ["Vancouver Stadium"],
  "bmo field": ["Toronto Stadium"],
  "estadio akron": ["Guadalajara Stadium"],
  "estadio bbva": ["Monterrey Stadium"],
  "estadio azteca": ["Mexico City Stadium", "Estadio Ciudad de Mexico"],
}

export function normalizeVenueName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

/** Known event-time aliases for a venue name (FIFA rebrands etc.). Pure + testable. */
export function aliasesFor(name: string): string[] {
  return KNOWN_ALIASES[normalizeVenueName(name)] ?? []
}

/** True when a catalog venue is big enough that a coincident event is "major". */
export function isMajorCapacity(capacityHigh: number | null | undefined): boolean {
  return (capacityHigh ?? 0) >= MAJOR_CAPACITY_THRESHOLD
}

/**
 * Capacity to RANK a venue by when picking the scarce event probes. For a MEASURED
 * venue we trust the number; for a type-PRIOR venue we use the conservative LOW end
 * of the range, NOT the optimistic high. Otherwise a small venue Google mis-typed
 * as e.g. "stadium" inherits the 85k prior ceiling and outranks a real measured
 * arena, stealing the top probe slot. Inclusion stays generous (isMajorCapacity on
 * capacityHigh); this only ORDERS the slots. Pure + testable.
 */
export function effectiveCapacity(
  v: Pick<CatalogVenue, "capacityLow" | "capacityHigh" | "capacityConfidence">,
): number {
  if (v.capacityConfidence === "measured") return v.capacityHigh ?? v.capacityLow ?? 0
  return v.capacityLow ?? 0
}

/** Find the catalog venue an event's geocoded point lands on (coordinate match,
 *  rebrand-proof). Returns the closest within tolerance, or null. Pure + testable. */
export function matchEventToCatalog(
  eventLat: number | null | undefined,
  eventLng: number | null | undefined,
  catalog: CatalogVenue[],
): CatalogVenue | null {
  if (eventLat == null || eventLng == null) return null
  let best: CatalogVenue | null = null
  let bestDist = Infinity
  for (const v of catalog) {
    if (v.lat == null || v.lng == null) continue
    const d = haversineMiles(eventLat, eventLng, v.lat, v.lng)
    if (d <= MATCH_TOLERANCE_MI && d < bestDist) {
      best = v
      bestDist = d
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Sweep — build the catalog from a lat/lng (network: Places searchNearby/Text)
// ---------------------------------------------------------------------------

export async function buildVenueCatalog(
  lat: number,
  lng: number,
  opts: { excludePlaceId?: string } = {},
): Promise<CatalogVenue[]> {
  const byPlaceId = new Map<string, CatalogVenue>()

  const consider = (
    p: {
      placeId: string
      name: string
      primaryType: string | null
      lat?: number | null
      lng?: number | null
      distanceMeters: number | null
    },
    capLow: number,
    capHigh: number,
  ) => {
    if (!p.placeId || p.placeId === opts.excludePlaceId || !p.name) return
    const distanceMi =
      p.distanceMeters != null ? Math.round((p.distanceMeters / M_PER_MILE) * 10) / 10 : null
    const existing = byPlaceId.get(p.placeId)
    // Keep the LARGER capacity prior if a venue surfaces under multiple type passes.
    if (existing) {
      existing.capacityHigh = Math.max(existing.capacityHigh ?? 0, capHigh)
      existing.capacityLow = Math.max(existing.capacityLow ?? 0, capLow)
      return
    }
    byPlaceId.set(p.placeId, {
      placeId: p.placeId,
      name: p.name,
      primaryType: p.primaryType,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      distanceMi,
      capacityLow: capLow,
      capacityHigh: capHigh,
      capacityConfidence: "prior",
      aliases: aliasesFor(p.name),
    })
  }

  // One searchNearby call per type (each fails soft — an invalid/empty type just
  // yields nothing rather than aborting the whole sweep).
  for (const t of VENUE_TAXONOMY) {
    try {
      const places = await fetchNearbyPlaces(lat, lng, {
        includedTypes: [t.includedType],
        radius: Math.round(t.radiusMi * M_PER_MILE),
        maxResultCount: 20,
        excludePlaceId: opts.excludePlaceId,
      })
      for (const p of places) consider(p, t.capLow, t.capHigh)
    } catch (err) {
      console.warn(`[venue-catalog] type "${t.includedType}" sweep failed:`, String(err))
    }
  }

  return Array.from(byPlaceId.values()).sort(
    (a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity),
  )
}

// ---------------------------------------------------------------------------
// Capacity enrichment — best-effort measured capacity from Wikidata (P1083)
// ---------------------------------------------------------------------------

/** Best-effort: upgrade a venue's capacity to a MEASURED number via Wikidata.
 *  Fails soft to the type prior. Only worth calling for large-draw venues. */
export async function enrichCapacityFromWikidata(venue: CatalogVenue): Promise<CatalogVenue> {
  try {
    const search = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=1&search=${encodeURIComponent(venue.name)}`,
      { headers: { "User-Agent": "TicketEventsEngine/1.0 (alivelabs.io)" } },
    )
    if (!search.ok) return venue
    const sj = (await search.json()) as { search?: Array<{ id?: string }> }
    const id = sj.search?.[0]?.id
    if (!id) return venue

    const ent = await fetch(
      `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`,
      { headers: { "User-Agent": "TicketEventsEngine/1.0 (alivelabs.io)" } },
    )
    if (!ent.ok) return venue
    const ej = (await ent.json()) as {
      entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: { amount?: string } } } }>> }>
    }
    const claim = ej.entities?.[id]?.claims?.["P1083"]?.[0]
    const amount = claim?.mainsnak?.datavalue?.value?.amount
    const capacity = amount ? Math.abs(parseInt(amount, 10)) : NaN
    if (Number.isFinite(capacity) && capacity > 0) {
      return { ...venue, capacityLow: capacity, capacityHigh: capacity, capacityConfidence: "measured" }
    }
  } catch {
    /* fail soft to prior */
  }
  return venue
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function upsertVenueCatalog(
  supabase: SupabaseClient,
  locationId: string,
  venues: CatalogVenue[],
): Promise<void> {
  if (venues.length === 0) return
  const rows = venues.map((v) => ({
    location_id: locationId,
    place_id: v.placeId,
    name: v.name,
    primary_type: v.primaryType,
    lat: v.lat,
    lng: v.lng,
    distance_mi: v.distanceMi,
    capacity_low: v.capacityLow,
    capacity_high: v.capacityHigh,
    capacity_confidence: v.capacityConfidence,
    aliases: v.aliases,
    refreshed_at: new Date().toISOString(),
  }))
  await supabase.from("venue_catalog").upsert(rows, { onConflict: "location_id,place_id" })
}

const CATALOG_TTL_DAYS = 90 // venues are static; rebuild quarterly

/** Load the catalog, building it (Places sweep + capacity enrichment) when it's missing
 *  or stale (>90d). Self-healing: the first events run for a location builds it, and it
 *  refreshes quarterly — no separate onboarding hook to keep in sync. Fails soft to
 *  whatever is cached. */
export async function ensureVenueCatalog(
  supabase: SupabaseClient,
  locationId: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
  opts: { excludePlaceId?: string; now?: Date } = {},
): Promise<CatalogVenue[]> {
  const now = opts.now ?? new Date()
  const { data: meta } = await supabase
    .from("venue_catalog")
    .select("refreshed_at")
    .eq("location_id", locationId)
    .order("refreshed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const refreshedAt = meta?.refreshed_at as string | undefined
  const fresh = refreshedAt && now.getTime() - Date.parse(refreshedAt) < CATALOG_TTL_DAYS * 86400_000
  if (fresh) return loadVenueCatalog(supabase, locationId)
  if (lat == null || lng == null) return loadVenueCatalog(supabase, locationId)

  try {
    let venues = await buildVenueCatalog(lat, lng, { excludePlaceId: opts.excludePlaceId })
    // Upgrade the few biggest-draw venues to a MEASURED capacity (bounded, best-effort).
    const topMajor = venues.filter((v) => isMajorCapacity(v.capacityHigh)).slice(0, 5)
    const enriched = await Promise.all(topMajor.map((v) => enrichCapacityFromWikidata(v)))
    const byId = new Map(enriched.filter((v) => v.placeId).map((v) => [v.placeId as string, v]))
    venues = venues.map((v) => (v.placeId && byId.has(v.placeId) ? byId.get(v.placeId)! : v))
    await upsertVenueCatalog(supabase, locationId, venues)
    return venues
  } catch (err) {
    console.warn(`[venue-catalog] ensure failed for ${locationId}:`, String(err))
    return loadVenueCatalog(supabase, locationId)
  }
}

export async function loadVenueCatalog(
  supabase: SupabaseClient,
  locationId: string,
): Promise<CatalogVenue[]> {
  const { data } = await supabase
    .from("venue_catalog")
    .select("place_id,name,primary_type,lat,lng,distance_mi,capacity_low,capacity_high,capacity_confidence,aliases")
    .eq("location_id", locationId)
    .order("distance_mi", { ascending: true })

  return (data ?? []).map((r) => ({
    placeId: (r.place_id as string | null) ?? null,
    name: r.name as string,
    primaryType: (r.primary_type as string | null) ?? null,
    lat: (r.lat as number | null) ?? null,
    lng: (r.lng as number | null) ?? null,
    distanceMi: (r.distance_mi as number | null) ?? null,
    capacityLow: (r.capacity_low as number | null) ?? null,
    capacityHigh: (r.capacity_high as number | null) ?? null,
    capacityConfidence: ((r.capacity_confidence as string) ?? "prior") as CapacityConfidence,
    aliases: ((r.aliases as string[] | null) ?? []),
  }))
}
