import { fetchWithRetry } from "@/lib/http/fetch-with-retry"

type GooglePlacesAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string
      text?: {
        text?: string
      }
    }
  }>
  error?: {
    message?: string
    status?: string
  }
}

type GooglePlaceDetailsResponse = {
  id?: string
  displayName?: {
    text?: string
  }
  primaryType?: string
  types?: string[]
  formattedAddress?: string
  shortFormattedAddress?: string
  adrFormatAddress?: string
  websiteUri?: string
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  rating?: number
  userRatingCount?: number
  businessStatus?: string
  priceLevel?: string
  googleMapsUri?: string
  utcOffsetMinutes?: number
  editorialSummary?: {
    text?: string
  }
  // Service + daypart signals (field-masked below). dineIn distinguishes a QSR
  // with a lobby (Cane's) from drive-thru/takeout-only; servesLunch/Dinner are
  // the reliable daypart gate (P1) — no text parsing of weekdayDescriptions.
  dineIn?: boolean
  takeout?: boolean
  servesBreakfast?: boolean
  servesLunch?: boolean
  servesDinner?: boolean
  servesBrunch?: boolean
  currentOpeningHours?: {
    weekdayDescriptions?: string[]
    openNow?: boolean
  }
  regularOpeningHours?: {
    weekdayDescriptions?: string[]
  }
  reviews?: Array<{
    rating?: number
    relativePublishTimeDescription?: string
    text?: {
      text?: string
    }
    authorAttribution?: {
      displayName?: string
    }
  }>
  addressComponents?: Array<{
    longText?: string
    shortText?: string
    types?: string[]
  }>
  location?: {
    latitude?: number
    longitude?: number
  }
}

function getGoogleKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured")
  }
  return key
}

export type AutocompleteOptions = {
  lat?: number
  lng?: number
  radius?: number
}

const DEFAULT_LOCATION_BIAS_RADIUS_METERS = 50_000

export async function fetchAutocomplete(input: string, options: AutocompleteOptions = {}) {
  const { lat, lng, radius } = options
  const hasCoords = typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
  const body: Record<string, unknown> = {
    input,
    includedPrimaryTypes: ["establishment"],
  }
  if (hasCoords) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius && Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_LOCATION_BIAS_RADIUS_METERS,
      },
    }
  }
  const response = await fetchWithRetry("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getGoogleKey(),
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
    },
    body: JSON.stringify(body),
  })

  const data = (await response.json()) as GooglePlacesAutocompleteResponse
  if (!response.ok) {
    throw new Error(
      `Google Places error: ${data.error?.status ?? response.status} - ${
        data.error?.message ?? "Unknown error"
      }`
    )
  }

  return (
    data.suggestions
      ?.map((suggestion) => ({
        place_id: suggestion.placePrediction?.placeId ?? "",
        description: suggestion.placePrediction?.text?.text ?? "",
      }))
      .filter((item) => item.place_id && item.description) ?? []
  )
}

export async function fetchPlaceDetails(placeId: string) {
  const response = await fetchWithRetry(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": getGoogleKey(),
      "X-Goog-FieldMask":
        "id,displayName,primaryType,types,formattedAddress,shortFormattedAddress,adrFormatAddress,addressComponents,location,websiteUri,nationalPhoneNumber,internationalPhoneNumber,rating,userRatingCount,businessStatus,priceLevel,googleMapsUri,utcOffsetMinutes,editorialSummary,dineIn,takeout,servesBreakfast,servesLunch,servesDinner,servesBrunch,currentOpeningHours,regularOpeningHours,reviews",
    },
    next: { revalidate: 604800, tags: ["place-details"] },
  })

  if (!response.ok) {
    const data = (await response.json()) as { error?: { message?: string; status?: string } }
    throw new Error(
      `Google Places error: ${data.error?.status ?? response.status} - ${
        data.error?.message ?? "Unknown error"
      }`
    )
  }

  return (await response.json()) as GooglePlaceDetailsResponse
}

function getComponent(
  components: GooglePlaceDetailsResponse["addressComponents"] | undefined,
  type: string
) {
  const match = components?.find((component) => component.types?.includes(type))
  return match?.longText ?? null
}

type GoogleNearbyResponse = {
  places?: Array<{
    id?: string
    displayName?: { text?: string }
    primaryType?: string
    types?: string[]
    rating?: number
    userRatingCount?: number
    priceLevel?: string
    location?: { latitude?: number; longitude?: number }
  }>
  error?: { message?: string; status?: string }
}

export type DiscoveredCompetitor = {
  placeId: string
  name: string
  primaryType: string | null
  types: string[]
  rating: number | null
  reviewCount: number | null
  priceLevel: string | null
  distanceMeters: number | null
  lat?: number | null
  lng?: number | null
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Nearby places of arbitrary type(s) (Places searchNearby). The generic primitive behind both
 *  competitor discovery (includedTypes:["restaurant"]) and the events venue radar (stadium/arena/
 *  theater/… taxonomy). One call returns up to maxResultCount (Places caps at 20) ranked by
 *  distance, so callers TILE per type/radius to avoid the same truncation class as the depth-10
 *  events bug. */
export async function fetchNearbyPlaces(
  lat: number,
  lng: number,
  opts: {
    includedTypes: string[]
    radius?: number
    maxResultCount?: number
    excludePlaceId?: string
    limit?: number
  },
): Promise<DiscoveredCompetitor[]> {
  const response = await fetchWithRetry("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getGoogleKey(),
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.primaryType,places.types,places.rating,places.userRatingCount,places.priceLevel,places.location",
    },
    body: JSON.stringify({
      includedTypes: opts.includedTypes,
      maxResultCount: Math.min(opts.maxResultCount ?? 20, 20),
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: opts.radius ?? 3000 },
      },
    }),
  })

  const data = (await response.json()) as GoogleNearbyResponse
  if (!response.ok) {
    throw new Error(`Google Places error: ${data.error?.status ?? response.status} - ${data.error?.message ?? "Unknown error"}`)
  }

  return (data.places ?? [])
    .filter((p) => p.id && p.id !== opts.excludePlaceId && p.displayName?.text)
    .map((p) => ({
      placeId: p.id as string,
      name: p.displayName?.text as string,
      primaryType: p.primaryType ?? null,
      types: p.types ?? [],
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? null,
      priceLevel: p.priceLevel ?? null,
      distanceMeters:
        typeof p.location?.latitude === "number" && typeof p.location?.longitude === "number"
          ? Math.round(haversineMeters(lat, lng, p.location.latitude, p.location.longitude))
          : null,
      lat: typeof p.location?.latitude === "number" ? p.location.latitude : null,
      lng: typeof p.location?.longitude === "number" ? p.location.longitude : null,
    }))
    .slice(0, opts.limit ?? 20)
}

/** Nearby restaurants for competitor discovery (Places searchNearby, ranked by distance). */
export async function fetchNearbyCompetitors(
  lat: number,
  lng: number,
  opts: { radius?: number; excludePlaceId?: string; limit?: number } = {},
): Promise<DiscoveredCompetitor[]> {
  return fetchNearbyPlaces(lat, lng, {
    includedTypes: ["restaurant"],
    radius: opts.radius ?? 3000,
    excludePlaceId: opts.excludePlaceId,
    limit: opts.limit ?? 8,
  })
}

export function mapPlaceToLocation(result: GooglePlaceDetailsResponse) {
  return {
    primary_place_id: result.id ?? "",
    name: result.displayName?.text ?? "",
    category: result.primaryType ?? null,
    types: result.types ?? [],
    address_line1: result.formattedAddress ?? null,
    city: getComponent(result.addressComponents, "locality"),
    region: getComponent(result.addressComponents, "administrative_area_level_1"),
    postal_code: getComponent(result.addressComponents, "postal_code"),
    country: getComponent(result.addressComponents, "country"),
    geo_lat: result.location?.latitude ?? null,
    geo_lng: result.location?.longitude ?? null,
    phone:
      result.internationalPhoneNumber ??
      result.nationalPhoneNumber ??
      null,
    website: result.websiteUri ?? null,
  }
}
