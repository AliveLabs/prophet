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

const cache = new Map<string, LatLng | null>()

export type GeocodeOpts = { supabase?: SupabaseClient }

export async function geocodeVenue(
  name: string | undefined,
  address: string | undefined,
  opts: GeocodeOpts = {},
): Promise<LatLng | null> {
  const query = [name, address].filter(Boolean).join(", ").trim()
  if (!query) return null
  const key = query.toLowerCase()
  if (cache.has(key)) return cache.get(key) ?? null

  const sb = opts.supabase
  // L2: persistent cache hit (only successful resolutions are ever stored).
  if (sb) {
    const { data } = await sb
      .from("venue_geocode_cache")
      .select("lat,lng")
      .eq("query_key", key)
      .maybeSingle()
    if (data && typeof data.lat === "number" && typeof data.lng === "number") {
      const hit = { lat: data.lat, lng: data.lng }
      cache.set(key, hit)
      return hit
    }
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location",
      },
      body: JSON.stringify({ textQuery: query, pageSize: 1 }),
    })
    if (!res.ok) {
      cache.set(key, null)
      return null
    }
    const data = (await res.json()) as { places?: Array<{ location?: { latitude?: number; longitude?: number } }> }
    const loc = data.places?.[0]?.location
    const out = typeof loc?.latitude === "number" && typeof loc?.longitude === "number" ? { lat: loc.latitude, lng: loc.longitude } : null
    cache.set(key, out)
    // Persist successful resolutions only — a transient null must not be cached
    // forever (it'll retry next run via L1 miss). Best-effort; never block geo.
    if (sb && out) {
      await sb
        .from("venue_geocode_cache")
        .upsert(
          { query_key: key, lat: out.lat, lng: out.lng, resolved_at: new Date().toISOString() },
          { onConflict: "query_key" },
        )
    }
    return out
  } catch {
    cache.set(key, null)
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
