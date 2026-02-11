// ---------------------------------------------------------------------------
// DataForSEO Labs – Ranked Keywords (Live)
// Docs: https://docs.dataforseo.com/v3/dataforseo_labs-google-ranked_keywords-live/
// ---------------------------------------------------------------------------

import { postDataForSEO, extractFirstResult, type DataForSEOTaskResponse } from "./client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RankedKeywordsInput = {
  target: string
  locationCode?: number
  languageCode?: string
  limit?: number
  offset?: number
  orderBy?: string[]
}

export type RankedKeywordItem = {
  se_type?: string
  keyword_data?: {
    keyword?: string
    keyword_info?: {
      se_type?: string
      last_updated_time?: string
      search_volume?: number
      competition?: number
      competition_level?: string
      cpc?: number
      monthly_searches?: Array<{ year: number; month: number; search_volume: number }>
    }
    search_intent_info?: {
      se_type?: string
      main_intent?: string // "informational" | "commercial" | "navigational" | "transactional"
      foreign_intent?: string[]
    }
    keyword_properties?: {
      se_type?: string
      core_keyword?: string | null
      keyword_difficulty?: number
      detected_language?: string
      is_another_language?: boolean
    }
    serp_info?: {
      se_type?: string
      check_url?: string
      serp_item_types?: string[]
    }
  }
  ranked_serp_element?: {
    se_type?: string
    serp_item?: {
      type?: string
      rank_group?: number
      rank_absolute?: number
      position?: string
      url?: string
      title?: string
      description?: string
      is_paid?: boolean
    }
  }
}

export type RankedKeywordsResult = {
  target: string
  location_code: number
  language_code: string
  total_count: number
  items_count: number
  items: RankedKeywordItem[]
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchRankedKeywords(
  input: RankedKeywordsInput
): Promise<RankedKeywordsResult | null> {
  const task = {
    target: input.target,
    location_code: input.locationCode ?? 2840,
    language_code: input.languageCode ?? "en",
    limit: input.limit ?? 25,
    offset: input.offset ?? 0,
    ...(input.orderBy ? { order_by: input.orderBy } : {}),
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<RankedKeywordsResult>>(
    "/v3/dataforseo_labs/google/ranked_keywords/live",
    [task]
  )

  return extractFirstResult(data, "ranked_keywords")
}
