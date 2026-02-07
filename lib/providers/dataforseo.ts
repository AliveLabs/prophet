import type { Provider, ProviderCandidate, NormalizedSnapshot } from "./types"
import { postDataForSEO } from "./dataforseo/client"

type DataForSEOResultItem = {
  title?: string
  category?: string
  cid?: string
  place_id?: string
  rating?: number
  reviews_count?: number
  distance?: number
}

type DataForSEOResponse = {
  tasks?: Array<{
    status_message?: string
    result?: Array<{
      items?: DataForSEOResultItem[]
    }>
  }>
}

type DataForSEOSnapshotItem = {
  title?: string
  rating?: number
  reviews_count?: number
  price_level?: string
  address?: string
  phone?: string
  site?: string
  work_hours?: Record<string, string>
}

type DataForSEOSnapshotResponse = {
  tasks?: Array<{
    result?: Array<{
      items?: DataForSEOSnapshotItem[]
    }>
  }>
}

export const dataForSeoProvider: Provider = {
  name: "dataforseo",
  async fetchCompetitorsNear({ lat, lng, radiusMeters, query }) {
    const keywordRaw = query ?? "restaurant"
    const keyword = keywordRaw.replace(/_/g, " ").trim()
    const radiusKm = Math.max(1, Math.round(radiusMeters / 1000))
    const baseTask = {
      keyword,
      location_coordinate: `${lat},${lng},12z`,
      radius: radiusKm,
      language_code: "en",
      device: "desktop",
      depth: 50,
    } as Record<string, unknown>

    const data = await postDataForSEO<DataForSEOResponse>(
      "/v3/serp/google/local_finder/live/advanced",
      [baseTask]
    )

    let items = data.tasks?.[0]?.result?.[0]?.items ?? []
    if (items.length === 0) {
      const status = data.tasks?.[0]?.status_message ?? "No items returned"
      console.error("DataForSEO local_finder empty result:", {
        status,
        keyword,
        lat,
        lng,
        radiusKm,
      })
    }

    if (items.length === 0) {
      const fallbackTask = {
        ...baseTask,
        radius: Math.max(radiusKm, 15),
      }
      const fallbackData = await postDataForSEO<DataForSEOResponse>(
        "/v3/serp/google/local_finder/live/advanced",
        [fallbackTask]
      )
      items = fallbackData.tasks?.[0]?.result?.[0]?.items ?? []
      if (items.length === 0) {
        const status = fallbackData.tasks?.[0]?.status_message ?? "No items returned"
        console.error("DataForSEO fallback empty result:", {
          status,
          keyword,
          lat,
          lng,
          radiusKm: Math.max(radiusKm, 10),
        })
      }
    }

    if (items.length === 0) {
      const status = data.tasks?.[0]?.status_message ?? "No items returned"
      throw new Error(`DataForSEO returned no competitors. ${status}`)
    }

    return items
      .map((item): ProviderCandidate | null => {
        const providerEntityId = item.place_id ?? item.cid
        if (!providerEntityId) {
          return null
        }
        return {
          providerEntityId: String(providerEntityId),
          name: item.title ?? "Unknown",
          category: item.category,
          distanceMeters: item.distance ? item.distance * 1000 : undefined,
          rating: item.rating,
          reviewCount: item.reviews_count,
          raw: item,
        }
      })
      .filter((item): item is ProviderCandidate => Boolean(item))
  },
  async fetchSnapshot({ providerEntityId }) {
    const payload = [
      {
        place_id: providerEntityId,
        language_name: "English",
      },
    ]

    const data = await postDataForSEO<DataForSEOSnapshotResponse>(
      "/v3/business_data/google/my_business_info/live",
      payload
    )

    return data.tasks?.[0]?.result?.[0]?.items?.[0] ?? null
  },
  normalizeSnapshot(raw: unknown): NormalizedSnapshot {
    const item = (raw ?? {}) as DataForSEOSnapshotItem
    return {
      version: "1.0",
      timestamp: new Date().toISOString(),
      profile: {
        title: item.title,
        rating: item.rating,
        reviewCount: item.reviews_count,
        priceLevel: item.price_level,
        address: item.address,
        website: item.site,
        phone: item.phone,
      },
      hours: item.work_hours,
      source_raw: raw,
    }
  },
}
