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
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
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
  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": getGoogleKey(),
      "X-Goog-FieldMask":
        "id,displayName,primaryType,types,formattedAddress,shortFormattedAddress,adrFormatAddress,addressComponents,location,websiteUri,nationalPhoneNumber,internationalPhoneNumber,rating,userRatingCount,businessStatus,priceLevel,googleMapsUri,utcOffsetMinutes,editorialSummary,currentOpeningHours,regularOpeningHours,reviews",
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
