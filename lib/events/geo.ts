// ---------------------------------------------------------------------------
// Event venue geocoding (Event geo-relevance · Layer 1)
//
// Geography is the events' content_as_of: an event isn't "local" because the
// search said so — it's local because its venue is measurably near the restaurant.
// Geocoder = Places API searchText (verified enabled on this key; the classic
// Geocoding API is NOT — probed 2026-06-09 → REQUEST_DENIED). Results cached
// per process (venues repeat week to week).
// ---------------------------------------------------------------------------

export type LatLng = { lat: number; lng: number }

const cache = new Map<string, LatLng | null>()

export async function geocodeVenue(name: string | undefined, address: string | undefined): Promise<LatLng | null> {
  const query = [name, address].filter(Boolean).join(", ").trim()
  if (!query) return null
  const key = query.toLowerCase()
  if (cache.has(key)) return cache.get(key) ?? null

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
