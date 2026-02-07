// ---------------------------------------------------------------------------
// DataForSEO – Google Ads Search SERP (Live Advanced)
// Docs: https://docs.dataforseo.com/v3/serp-google-ads_search-overview/
// ---------------------------------------------------------------------------

import { postDataForSEO, type DataForSEOTaskResponse } from "./client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdsSearchInput = {
  keyword: string
  locationCode?: number
  languageCode?: string
  device?: "desktop" | "mobile"
  depth?: number
}

export type AdsSearchItem = {
  type?: string
  rank_group?: number
  rank_absolute?: number
  position?: string
  domain?: string
  url?: string
  title?: string
  description?: string
  breadcrumb?: string
  highlighted?: string[]
  extra?: Record<string, unknown>
}

export type AdsSearchResult = {
  keyword: string
  type?: string
  se_domain?: string
  location_code?: number
  language_code?: string
  check_url?: string
  datetime?: string
  item_types?: string[]
  items_count?: number
  items: AdsSearchItem[]
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchAdsSearch(
  input: AdsSearchInput
): Promise<AdsSearchResult | null> {
  const task = {
    keyword: input.keyword,
    location_code: input.locationCode ?? 2840,
    language_code: input.languageCode ?? "en",
    device: input.device ?? "desktop",
    depth: input.depth ?? 40,
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<AdsSearchResult>>(
    "/v3/serp/google/ads_search/live/advanced",
    [task]
  )

  const taskResult = data.tasks?.[0]
  if (taskResult?.status_code && taskResult.status_code !== 20000) {
    throw new Error(
      `DataForSEO Ads Search error: ${taskResult.status_code} ${taskResult.status_message ?? ""}`
    )
  }

  return taskResult?.result?.[0] ?? null
}
