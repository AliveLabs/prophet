// ---------------------------------------------------------------------------
// DataForSEO Labs – Subdomains (Live)
// Docs: https://docs.dataforseo.com/v3/dataforseo_labs/google/subdomains/live
// ---------------------------------------------------------------------------

import { postDataForSEO, extractFirstResult, type DataForSEOTaskResponse } from "./client"
import { locationTask } from "./location-scope"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubdomainsInput = {
  target: string
  /** ALT-636: the location's own market, "City,Region,United States". Takes precedence
   *  over locationCode. Exactly one reaches the wire; see locationTask(). */
  locationName?: string
  locationCode?: number
  languageCode?: string
  limit?: number
}

export type SubdomainItem = {
  subdomain?: string
  metrics?: {
    organic?: {
      pos_1?: number
      pos_2_3?: number
      pos_4_10?: number
      pos_11_20?: number
      pos_21_30?: number
      etv?: number
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
    }
  }
}

export type SubdomainsResult = {
  target?: string
  location_code?: number
  language_code?: string
  total_count?: number
  items_count?: number
  items?: SubdomainItem[]
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchSubdomains(
  input: SubdomainsInput
): Promise<SubdomainsResult | null> {
  const task = {
    target: input.target,
    ...locationTask(input),
    language_code: input.languageCode ?? "en",
    limit: input.limit ?? 10,
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<SubdomainsResult>>(
    "/v3/dataforseo_labs/google/subdomains/live",
    [task]
  )

  return extractFirstResult(data, "subdomains")
}
