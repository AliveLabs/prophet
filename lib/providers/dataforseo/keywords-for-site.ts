// ---------------------------------------------------------------------------
// DataForSEO Labs – Keywords For Site (Live)
// Docs: https://docs.dataforseo.com/v3/dataforseo_labs-google-keywords_for_site-live/
// ---------------------------------------------------------------------------

import { postDataForSEO, extractFirstResult, type DataForSEOTaskResponse } from "./client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KeywordsForSiteInput = {
  target: string
  locationCode?: number
  languageCode?: string
  limit?: number
}

export type KeywordForSiteItem = {
  keyword?: string
  keyword_info?: {
    search_volume?: number
    competition?: number
    competition_level?: string
    cpc?: number
    monthly_searches?: Array<{ year: number; month: number; search_volume: number }>
  }
  impressions_info?: {
    se_type?: string
    bid?: number
    match_type?: string
    ad_position_min?: number
    ad_position_max?: number
    ad_position_average?: number
    cpc_min?: number
    cpc_max?: number
    daily_impressions_min?: number
    daily_impressions_max?: number
    daily_clicks_min?: number
    daily_clicks_max?: number
    daily_cost_min?: number
    daily_cost_max?: number
  }
}

export type KeywordsForSiteResult = {
  target: string
  location_code: number
  language_code: string
  total_count: number
  items_count: number
  items: KeywordForSiteItem[]
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchKeywordsForSite(
  input: KeywordsForSiteInput
): Promise<KeywordsForSiteResult | null> {
  const task = {
    target: input.target,
    location_code: input.locationCode ?? 2840,
    language_code: input.languageCode ?? "en",
    limit: input.limit ?? 25,
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<KeywordsForSiteResult>>(
    "/v3/dataforseo_labs/google/keywords_for_site/live",
    [task]
  )

  return extractFirstResult(data, "keywords_for_site")
}
