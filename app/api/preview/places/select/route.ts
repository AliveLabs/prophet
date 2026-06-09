// On picking a restaurant in onboarding: fetch real Google place details (to prefill
// the confirm step) + discover real nearby competitors (with a "why" each was picked).
// Server-side (key stays private), prod-guarded. Degrades gracefully on error.

import { fetchPlaceDetails, fetchNearbyCompetitors } from "@/lib/places/google"
import { priceLevelToSymbols, typeToCuisine, formatDistance } from "@/lib/places/format"

// Not real competitors for a sit-down restaurant — drop these from discovery.
const NOT_A_COMPETITOR = new Set([
  "fast_food_restaurant", "meal_takeaway", "meal_delivery", "juice_shop", "coffee_shop",
  "cafe", "bakery", "ice_cream_shop", "dessert_shop", "dessert_restaurant", "donut_shop",
  "convenience_store", "supermarket", "grocery_store", "gas_station",
])

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production") return new Response("Not found", { status: 404 })
  const placeId = new URL(req.url).searchParams.get("placeId")?.trim() ?? ""
  if (!placeId) return Response.json({ error: "placeId required" }, { status: 400 })

  try {
    const d = await fetchPlaceDetails(placeId)
    const ownCuisine = typeToCuisine(d.primaryType, d.types)
    const place = {
      placeId: d.id ?? placeId,
      name: d.displayName?.text ?? "",
      address: d.formattedAddress ?? "",
      cuisine: ownCuisine,
      price: priceLevelToSymbols(d.priceLevel),
      website: d.websiteUri ? d.websiteUri.replace(/^https?:\/\//, "").replace(/\/$/, "") : "",
      lat: d.location?.latitude ?? null,
      lng: d.location?.longitude ?? null,
    }

    let competitors: Array<{ placeId: string; name: string; meta: string; why: string }> = []
    if (typeof place.lat === "number" && typeof place.lng === "number") {
      const nearby = await fetchNearbyCompetitors(place.lat, place.lng, { excludePlaceId: place.placeId, limit: 18 })
      // drop non-competitor types (fast food, juice, delivery, …), then put same-cuisine
      // spots first (stable sort preserves the distance order within each group), keep 6.
      const ranked = nearby
        .filter((c) => !(c.primaryType && NOT_A_COMPETITOR.has(c.primaryType)) && !c.types.some((t) => NOT_A_COMPETITOR.has(t)))
        .map((c) => ({ c, same: typeToCuisine(c.primaryType, c.types).toLowerCase() === ownCuisine.toLowerCase() }))
        .sort((a, b) => Number(b.same) - Number(a.same))
        .map((x) => x.c)
        .slice(0, 6)
      competitors = ranked.map((c) => {
        const cuisine = typeToCuisine(c.primaryType, c.types)
        const dist = formatDistance(c.distanceMeters)
        const meta = [cuisine, dist, c.rating != null ? `★ ${c.rating}` : null].filter(Boolean).join(" · ")
        const sameCuisine = cuisine.toLowerCase() === ownCuisine.toLowerCase()
        const why = sameCuisine
          ? `Same cuisine${dist ? `, ${dist} away` : ", nearby"}`
          : `Nearby ${cuisine.toLowerCase()} spot${dist ? `, ${dist} away` : ""}`
        return { placeId: c.placeId, name: c.name, meta, why }
      })
    }

    return Response.json({ place, competitors })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "lookup failed" })
  }
}
