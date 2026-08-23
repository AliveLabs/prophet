// ---------------------------------------------------------------------------
// DataForSEO Labs – Relevant Pages (Live)
// Docs: https://docs.dataforseo.com/v3/dataforseo_labs/google/relevant_pages/live
// ---------------------------------------------------------------------------

import { postDataForSEO, extractFirstResult, type DataForSEOTaskResponse } from "./client"
import { locationTask } from "./location-scope"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RelevantPagesInput = {
  target: string
  /** ALT-636: the location's own market, "City,Region,United States". Takes precedence
   *  over locationCode. Exactly one reaches the wire; see locationTask(). */
  locationName?: string
  locationCode?: number
  languageCode?: string
  limit?: number
}

export type RelevantPageItem = {
  page_address?: string
  metrics?: {
    organic?: {
      pos_1?: number
      pos_2_3?: number
      pos_4_10?: number
      pos_11_20?: number
      pos_21_30?: number
      pos_31_40?: number
      pos_41_50?: number
      pos_51_60?: number
      pos_61_70?: number
      pos_71_80?: number
      pos_81_90?: number
      pos_91_100?: number
      etv?: number
      impressions_etv?: number
      count?: number
      estimated_paid_traffic_cost?: number
      is_new?: number
      is_up?: number
      is_down?: number
      is_lost?: number
    }
    paid?: {
      etv?: number
      count?: number
      estimated_paid_traffic_cost?: number
    }
  }
}

export type RelevantPagesResult = {
  target?: string
  location_code?: number
  language_code?: string
  total_count?: number
  items_count?: number
  items?: RelevantPageItem[]
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchRelevantPages(
  input: RelevantPagesInput
): Promise<RelevantPagesResult | null> {
  const task = {
    target: input.target,
    ...locationTask(input),
    language_code: input.languageCode ?? "en",
    limit: input.limit ?? 25,
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<RelevantPagesResult>>(
    "/v3/dataforseo_labs/google/relevant_pages/live",
    [task]
  )

  return extractFirstResult(data, "relevant_pages")
}
