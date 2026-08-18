import { isServedCountry } from "@/lib/geo/us-only"
import { fetchWithRetry } from "@/lib/http/fetch-with-retry"

type GooglePlacesAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string
      text?: {
        text?: string
      }
      /** Straight-line meters from the request `origin` (only when origin is sent). */
      distanceMeters?: number
    }
  }>
  error?: {
    message?: string
    status?: string
  }
}

export type GooglePlaceDetailsResponse = {
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
  // ALT-347: the field mask requests the whole `reviews` object, so Google already
  // returns every subfield below — the type previously narrowed them away and the
  // normalizers dropped them. `name` is the stable review resource id (the upsert
  // key for persisted reviews), `publishTime` the absolute RFC3339 timestamp.
  reviews?: Array<{
    name?: string
    rating?: number
    relativePublishTimeDescription?: string
    publishTime?: string
    googleMapsUri?: string
    text?: {
      text?: string
    }
    authorAttribution?: {
      displayName?: string
      uri?: string
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
  const fields = [
    "suggestions.placePrediction.placeId",
    "suggestions.placePrediction.text",
  ]
  if (hasCoords) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius && Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_LOCATION_BIAS_RADIUS_METERS,
      },
    }
    // With an origin, each prediction carries distanceMeters in the SAME call
    // (probe-verified 2026-07-10: no latency difference) — lets pickers show
    // "2.1 mi" next to each result.
    body.origin = { latitude: lat, longitude: lng }
    fields.push("suggestions.placePrediction.distanceMeters")
  }
  const response = await fetchWithRetry("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getGoogleKey(),
      "X-Goog-FieldMask": fields.join(","),
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
        distance_meters:
          typeof suggestion.placePrediction?.distanceMeters === "number"
            ? suggestion.placePrediction.distanceMeters
            : null,
      }))
      .filter((item) => item.place_id && item.description) ?? []
  )
}

/**
 * A Places lookup that failed, carrying enough to tell WHY (ALT-606).
 *
 * The distinction matters because two very different things used to throw the same bare Error:
 * "Google is down" and "Google says there is no such place". Treating them alike meant a caller
 * either had to trust both or refuse both. The US-only guard has to trust the first (a vendor
 * blip must not block signups) and must not trust the second (an unverifiable place is exactly
 * how a crafted payload reaches the fallback).
 *
 * The message keeps its original shape so anything matching on the string still works.
 */
export class PlacesLookupError extends Error {
  constructor(
    message: string,
    /** HTTP status from Places, or 0 when the request never got one. */
    readonly httpStatus: number,
    /** Google's own status string, e.g. NOT_FOUND, INVALID_ARGUMENT. Null when absent. */
    readonly googleStatus: string | null,
  ) {
    super(message)
    this.name = "PlacesLookupError"
  }

  /**
   * True when the PLACE is the problem, not the vendor: a 4xx, which for this endpoint means
   * the id is malformed or names nothing. A caller must not fall back to client-supplied data
   * on one of these, because the client is the thing that just supplied a bad id.
   *
   * 429 is deliberately excluded: rate limiting is a 4xx, but it says nothing about the place.
   */
  get isPlaceFault(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500 && this.httpStatus !== 429
  }
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
    const data = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string }
    }
    throw new PlacesLookupError(
      `Google Places error: ${data.error?.status ?? response.status} - ${
        data.error?.message ?? "Unknown error"
      }`,
      response.status,
      data.error?.status ?? null,
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

/**
 * The component's SHORT text, which for `country` is the ISO 3166-1 alpha-2 code.
 *
 * ALT-606: the US-only guard needs a code, not a name. `longText` gives "United States", and
 * `locations.country` already holds that alongside the literal "US" that every insert falls back
 * to, so the column cannot be matched on reliably. The code can.
 */
function getComponentShort(
  components: GooglePlaceDetailsResponse["addressComponents"] | undefined,
  type: string
) {
  const match = components?.find((component) => component.types?.includes(type))
  return match?.shortText ?? null
}

/** ISO country code off a nearby result's address components (ALT-606). */
function countryCodeOf(
  components: Array<{ shortText?: string; types?: string[] }> | undefined,
): string | null {
  return components?.find((c) => c.types?.includes("country"))?.shortText ?? null
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
    shortFormattedAddress?: string
    addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>
    location?: { latitude?: number; longitude?: number }
  }>
  error?: { message?: string; status?: string }
}

export type DiscoveredCompetitor = {
  placeId: string
  /** ISO 3166-1 alpha-2 for the result, when Places returned a country component (ALT-606). */
  countryCode?: string | null
  name: string
  primaryType: string | null
  types: string[]
  rating: number | null
  reviewCount: number | null
  priceLevel: string | null
  address: string | null
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
        // ALT-606: addressComponents carries the country so discovery can drop cross-border results
        // before the operator ever sees them. It sits in the Pro SKU, below the Enterprise tier this
        // mask already pays for via rating/userRatingCount/priceLevel, so it adds no billing tier.
        "places.id,places.displayName,places.primaryType,places.types,places.rating,places.userRatingCount,places.priceLevel,places.shortFormattedAddress,places.location,places.addressComponents",
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
    // ALT-606: a 3km radius crosses a national border in plenty of real markets (Detroit,
    // San Diego, El Paso, Buffalo). Suggesting a rival the operator is then refused when they
    // pick it is a worse experience than never offering it. Approval is still guarded server
    // side; this only stops us proposing something we will not accept.
    .filter((p) => isServedCountry(countryCodeOf(p.addressComponents)))
    .map((p) => ({
      placeId: p.id as string,
      countryCode: countryCodeOf(p.addressComponents),
      name: p.displayName?.text as string,
      primaryType: p.primaryType ?? null,
      types: p.types ?? [],
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? null,
      priceLevel: p.priceLevel ?? null,
      address: p.shortFormattedAddress ?? null,
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
    // ISO 3166-1 alpha-2 (ALT-606). This is what the US-only guard decides on.
    country_code: getComponentShort(result.addressComponents, "country"),
    geo_lat: result.location?.latitude ?? null,
    geo_lng: result.location?.longitude ?? null,
    phone:
      result.internationalPhoneNumber ??
      result.nationalPhoneNumber ??
      null,
    website: result.websiteUri ?? null,
  }
}
