// ---------------------------------------------------------------------------
// DataForSEO – Google Ads Transparency Center (Live Advanced)
// Docs: https://docs.dataforseo.com/v3/serp/google/ads_search/live/advanced
// NOTE: This endpoint uses `target` (domain), NOT `keyword`.
// ---------------------------------------------------------------------------

import { postDataForSEO, type DataForSEOTaskResponse } from "./client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdsSearchInput = {
  target: string // domain name, e.g. "example.com"
  locationCode?: number
  languageCode?: string
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
  target?: string
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
    target: input.target,
    location_code: input.locationCode ?? 2840,
    language_code: input.languageCode ?? "en",
    depth: input.depth ?? 40,
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<AdsSearchResult>>(
    "/v3/serp/google/ads_search/live/advanced",
    [task]
  )

  const taskResult = data.tasks?.[0]
  if (taskResult?.status_code && taskResult.status_code !== 20000) {
    // 40102 = "No Search Results" — not an error, just no ads for this domain
    if (taskResult.status_code === 40102) return null
    throw new Error(
      `DataForSEO Ads Search error: ${taskResult.status_code} ${taskResult.status_message ?? ""}`
    )
  }

  return taskResult?.result?.[0] ?? null
}
