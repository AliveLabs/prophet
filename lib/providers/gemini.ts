import type { Provider, ProviderCandidate, NormalizedSnapshot } from "./types"

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

type GeminiGroundingChunk = {
  maps?: {
    uri?: string
    title?: string
    placeId?: string
    googleMapsUri?: string
  }
  web?: {
    uri?: string
    title?: string
  }
}

type GeminiGroundingMetadata = {
  groundingChunks?: GeminiGroundingChunk[]
  webSearchQueries?: string[]
  searchEntryPoint?: {
    renderedContent?: string
  }
  googleMapsWidgetContextToken?: string
}

type GeminiCandidate = {
  content?: {
    parts?: Array<{
      text?: string
    }>
  }
  groundingMetadata?: GeminiGroundingMetadata
}

type GeminiResponse = {
  candidates?: GeminiCandidate[]
}

type GeminiCompetitor = {
  name: string
  address?: string
  latitude?: number
  longitude?: number
  distance_meters?: number
  rating?: number
  review_count?: number
  place_id?: string
}

function getGeminiKey() {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) {
    throw new Error("GOOGLE_AI_API_KEY is not configured")
  }
  return key
}

function buildPrompt(input: {
  businessName?: string
  category?: string
  city?: string
  region?: string
  centerLat?: number
  centerLng?: number
}) {
  const base = [
    "You are a local business intelligence assistant.",
    "Return a JSON object with a single field 'competitors' that is an array of 5 to 10 items.",
    "Each item must include: name, address, latitude, longitude, distance_meters, rating, review_count, place_id (if known).",
    "Only include businesses that compete directly with the target business.",
    "Use the location context provided to find nearby competitors.",
    "Return JSON only. No markdown or commentary.",
  ]
  const details = [
    input.businessName ? `Target business name: ${input.businessName}.` : null,
    input.category ? `Category: ${input.category}.` : null,
    input.city ? `City: ${input.city}.` : null,
    input.region ? `Region: ${input.region}.` : null,
    input.centerLat && input.centerLng
      ? `Center coordinates: ${input.centerLat}, ${input.centerLng}. Use this as the origin for distance_meters.`
      : null,
  ].filter(Boolean)
  return [...base, ...details].join(" ")
}

function parseJson(text: string) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) {
      return null
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function normalizePlaceId(placeId?: string) {
  if (!placeId) return undefined
  if (placeId.startsWith("places/")) {
    return placeId.replace("places/", "")
  }
  return placeId
}

function extractSources(metadata?: GeminiGroundingMetadata) {
  const sources: Array<{
    type: "maps" | "web"
    title?: string
    url?: string
    placeId?: string
  }> = []
  const sourcesByPlaceId: Record<string, typeof sources> = {}
  for (const chunk of metadata?.groundingChunks ?? []) {
    if (chunk.maps) {
      const placeId = normalizePlaceId(chunk.maps.placeId)
      sources.push({
        type: "maps",
        title: chunk.maps.title,
        url: chunk.maps.googleMapsUri ?? chunk.maps.uri,
        placeId,
      })
      if (placeId) {
        sourcesByPlaceId[placeId] = sourcesByPlaceId[placeId] ?? []
        sourcesByPlaceId[placeId].push({
          type: "maps",
          title: chunk.maps.title,
          url: chunk.maps.googleMapsUri ?? chunk.maps.uri,
          placeId,
        })
      }
    }
    if (chunk.web) {
      sources.push({
        type: "web",
        title: chunk.web.title,
        url: chunk.web.uri,
      })
    }
  }
  return { sources, sourcesByPlaceId }
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function haversineMeters(input: {
  lat1: number
  lng1: number
  lat2: number
  lng2: number
}) {
  const earthRadiusMeters = 6371000
  const dLat = toRadians(input.lat2 - input.lat1)
  const dLng = toRadians(input.lng2 - input.lng1)
  const lat1 = toRadians(input.lat1)
  const lat2 = toRadians(input.lat2)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(earthRadiusMeters * c)
}

export const geminiProvider: Provider = {
  name: "gemini",
  async fetchCompetitorsNear({ lat, lng, radiusMeters, query }) {
    const prompt = buildPrompt({
      businessName: query,
      centerLat: lat,
      centerLng: lng,
    })

    const response = await fetch(`${GEMINI_API_URL}?key=${getGeminiKey()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        tools: [{ googleMaps: {} }, { googleSearch: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: lat,
              longitude: lng,
            },
          },
        },
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Gemini error: ${response.status} ${text}`)
    }

    const data = (await response.json()) as GeminiResponse
    const candidate = data.candidates?.[0]
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
    const parsed = parseJson(text) as { competitors?: GeminiCompetitor[] } | null
    const competitors = parsed?.competitors ?? []
    const { sources, sourcesByPlaceId } = extractSources(candidate?.groundingMetadata)
    const searchQueries = candidate?.groundingMetadata?.webSearchQueries ?? []
    const searchEntryPointHtml =
      candidate?.groundingMetadata?.searchEntryPoint?.renderedContent ?? null
    const mapsWidgetContextToken =
      candidate?.groundingMetadata?.googleMapsWidgetContextToken ?? null

    const groundedCandidates: ProviderCandidate[] = competitors
      .filter((item) => item?.name)
      .slice(0, 10)
      .map((item) => {
        const placeIdFromSources = sources.find(
          (source) =>
            source.type === "maps" &&
            source.placeId &&
            (source.title ?? "").toLowerCase().includes(item.name.toLowerCase())
        )?.placeId
        const placeId = normalizePlaceId(item.place_id) ?? placeIdFromSources
        const computedDistance =
          typeof item.latitude === "number" && typeof item.longitude === "number"
            ? haversineMeters({
                lat1: lat,
                lng1: lng,
                lat2: item.latitude,
                lng2: item.longitude,
              })
            : null
        const distanceMeters =
          typeof item.distance_meters === "number"
            ? item.distance_meters
            : computedDistance ?? undefined
        const candidateSources =
          placeId && sourcesByPlaceId[placeId]?.length
            ? sourcesByPlaceId[placeId]
            : sources.filter(
                (source) =>
                  source.type === "web" &&
                  (source.title ?? "").toLowerCase().includes(item.name.toLowerCase())
              )

        return {
          providerEntityId: placeId ?? `unknown:${item.name}`,
          name: item.name,
          category: undefined,
          distanceMeters,
          rating: item.rating,
          reviewCount: item.review_count,
          raw: {
            address: item.address,
            latitude: item.latitude,
            longitude: item.longitude,
            placeId,
            sources: candidateSources,
            searchQueries,
            searchEntryPointHtml,
            mapsWidgetContextToken,
          },
        }
      })

    if (groundedCandidates.length > 0) {
      return groundedCandidates
    }

    const fallbackCandidates =
      candidate?.groundingMetadata?.groundingChunks
        ?.map((chunk) => chunk.maps)
        .filter(Boolean)
        .map((mapsChunk): ProviderCandidate => ({
          providerEntityId:
            normalizePlaceId(mapsChunk?.placeId) ??
            `unknown:${mapsChunk?.title ?? "unknown"}`,
          name: mapsChunk?.title ?? "Unknown",
          category: undefined,
          distanceMeters: radiusMeters,
          rating: undefined,
          reviewCount: undefined,
          raw: {
            sources,
            searchQueries,
            searchEntryPointHtml,
            mapsWidgetContextToken,
          },
        })) ?? []

    return fallbackCandidates
  },
  async fetchSnapshot() {
    throw new Error("Gemini provider does not support snapshots yet")
  },
  normalizeSnapshot(): NormalizedSnapshot {
    return {
      version: "1.0",
      timestamp: new Date().toISOString(),
      source_raw: null,
    }
  },
}
