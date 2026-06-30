// ---------------------------------------------------------------------------
// Event venue geocoding (Event geo-relevance · Layer 1)
//
// Geography is the events' content_as_of: an event isn't "local" because the
// search said so — it's local because its venue is measurably near the restaurant.
// Geocoder = Places API searchText (verified enabled on this key; the classic
// Geocoding API is NOT — probed 2026-06-09 → REQUEST_DENIED).
//
// Two-layer cache (P0): an in-process Map (L1, fast within a run) backed by a
// persistent `venue_geocode_cache` table (L2, survives serverless cold starts).
// On Vercel the per-process map is cold on most invocations, so without L2 every
// event re-geocodes via the PAID searchText endpoint — and expanding event
// keywords (P1) returns MORE events, multiplying that bill. The L2 cache makes a
// venue geocode a one-time cost (venues repeat week to week). Pass `supabase` to
// engage L2; callers without a client still work via L1 + live fetch.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"

export type LatLng = { lat: number; lng: number }

/** A geocode result enriched with the venue's official website (when Google returned one).
 *  `website` is the geocoded venue's Google Place `websiteUri`, validated to a real http(s)
 *  URL — the data-layer fix for ALT-210 so the events page can deep-link to a real venue site
 *  instead of a generic bureau/convention-center landing page. */
export type VenueGeo = { lat: number; lng: number; website: string | null }

// L1: in-process cache. Carries the website alongside lat/lng so a within-run repeat venue
// reuses the resolved site too.
const cache = new Map<string, VenueGeo | null>()

export type GeocodeOpts = { supabase?: SupabaseClient }

const PLACES_SEARCH_TEXT = "https://places.googleapis.com/v1/places:searchText"

function placesApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? null
}

/** Validate + normalize a candidate venue website to a real http(s) URL, else null. NEVER
 *  fabricates: a missing / non-http / unparseable value yields null. Pure + testable. */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    return trimmed
  } catch {
    return null
  }
}

function venueQueryKey(name: string | undefined, address: string | undefined): string | null {
  const query = [name, address].filter(Boolean).join(", ").trim()
  return query ? query.toLowerCase() : null
}

/**
 * Geocode a venue AND resolve its official website in one paid Places searchText call.
 *
 * The website rides along on the SAME call we already make to geocode (just a wider field
 * mask: `places.location,places.websiteUri`), so capturing the venue's real site costs nothing
 * extra on a geocode miss. Two-layer cache as before: in-process Map (L1) backed by the
 * persistent `venue_geocode_cache` table (L2, now carrying `website`). Rows written before this
 * change have a null website — `annotateEventsGeo` backfills those a few at a time via
 * `resolveVenueWebsite`. Fail-soft throughout: a failure resolves lat/lng/website to nulls,
 * never throws.
 */
export async function geocodeVenueDetailed(
  name: string | undefined,
  address: string | undefined,
  opts: GeocodeOpts = {},
): Promise<VenueGeo | null> {
  const key = venueQueryKey(name, address)
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null

  const sb = opts.supabase
  // L2: persistent cache hit (only successful resolutions are ever stored). Tolerate the
  // `website` column being absent (code deployed just ahead of the migration) by falling back
  // to a lat/lng-only read — we still get the cache hit and never needlessly re-geocode.
  if (sb) {
    let row = await sb
      .from("venue_geocode_cache")
      .select("lat,lng,website")
      .eq("query_key", key)
      .maybeSingle()
    if (row.error) {
      row = await sb.from("venue_geocode_cache").select("lat,lng").eq("query_key", key).maybeSingle()
    }
    const data = row.data as { lat?: number; lng?: number; website?: string | null } | null
    if (data && typeof data.lat === "number" && typeof data.lng === "number") {
      const hit: VenueGeo = { lat: data.lat, lng: data.lng, website: normalizeWebsiteUrl(data.website ?? null) }
      cache.set(key, hit)
      return hit
    }
  }

  const apiKey = placesApiKey()
  if (!apiKey) return null

  const query = [name, address].filter(Boolean).join(", ").trim()
  try {
    const res = await fetch(PLACES_SEARCH_TEXT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location,places.websiteUri",
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1 }),
    })
    if (!res.ok) {
      cache.set(key, null)
      return null
    }
    const data = (await res.json()) as {
      places?: Array<{ location?: { latitude?: number; longitude?: number }; websiteUri?: string }>
    }
    const place = data.places?.[0]
    const loc = place?.location
    const out: VenueGeo | null =
      typeof loc?.latitude === "number" && typeof loc?.longitude === "number"
        ? { lat: loc.latitude, lng: loc.longitude, website: normalizeWebsiteUrl(place?.websiteUri) }
        : null
    cache.set(key, out)
    // Persist successful resolutions only — a transient null must not be cached
    // forever (it'll retry next run via L1 miss). Best-effort; never block geo.
    if (sb && out) {
      const resolvedAt = new Date().toISOString()
      const { error } = await sb
        .from("venue_geocode_cache")
        .upsert(
          { query_key: key, lat: out.lat, lng: out.lng, website: out.website, resolved_at: resolvedAt },
          { onConflict: "query_key" },
        )
      // Pre-migration the `website` column may not exist yet — still persist lat/lng so we avoid
      // re-geocoding; the website then resolves live each run until the column lands.
      if (error) {
        await sb
          .from("venue_geocode_cache")
          .upsert({ query_key: key, lat: out.lat, lng: out.lng, resolved_at: resolvedAt }, { onConflict: "query_key" })
      }
    }
    return out
  } catch {
    cache.set(key, null)
    return null
  }
}

/** Back-compat: lat/lng only (distance math + the audit script). Thin wrapper over
 *  `geocodeVenueDetailed` so there is a single network/cache path. */
export async function geocodeVenue(
  name: string | undefined,
  address: string | undefined,
  opts: GeocodeOpts = {},
): Promise<LatLng | null> {
  const r = await geocodeVenueDetailed(name, address, opts)
  return r ? { lat: r.lat, lng: r.lng } : null
}

/**
 * Backfill JUST the official website for a venue that is ALREADY geocoded but whose cache row
 * predates website capture (website is null). Does a website-only searchText and persists it
 * back onto the existing `venue_geocode_cache` row (and warms L1). Bounded by the caller so the
 * extra calls amortize across runs — once filled, it's free forever. Fail-soft → null.
 */
export async function resolveVenueWebsite(
  name: string | undefined,
  address: string | undefined,
  opts: GeocodeOpts = {},
): Promise<string | null> {
  const key = venueQueryKey(name, address)
  if (!key) return null
  const apiKey = placesApiKey()
  if (!apiKey) return null

  const query = [name, address].filter(Boolean).join(", ").trim()
  try {
    const res = await fetch(PLACES_SEARCH_TEXT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.websiteUri",
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1 }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { places?: Array<{ websiteUri?: string }> }
    const website = normalizeWebsiteUrl(data.places?.[0]?.websiteUri)
    if (!website) return null
    // Warm L1 (preserve the existing lat/lng) + persist onto the existing cache row.
    const cached = cache.get(key)
    if (cached) cache.set(key, { ...cached, website })
    const sb = opts.supabase
    if (sb) {
      await sb.from("venue_geocode_cache").update({ website }).eq("query_key", key)
    }
    return website
  } catch {
    return null
  }
}

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8 // earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10
}
