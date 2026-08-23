// ---------------------------------------------------------------------------
// DataForSEO Labs – Domain Rank Overview (Live)
// Docs: https://docs.dataforseo.com/v3/dataforseo_labs-google-domain_rank_overview-live/
// ---------------------------------------------------------------------------

import { postDataForSEO, extractFirstResult, type DataForSEOTaskResponse } from "./client"
import { locationTask } from "./location-scope"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DomainRankOverviewInput = {
  target: string // domain, e.g. "example.com"
  /** ALT-636: the location's own market, "City,Region,United States". Takes precedence
   *  over locationCode. Exactly one reaches the wire; see locationTask(). */
  locationName?: string
  locationCode?: number // default 2840 (United States)
  languageCode?: string // default "en"
}

export type DomainRankMetrics = {
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
  etv?: number // estimated traffic volume
  impressions_etv?: number
  count?: number // total ranked keywords
  estimated_paid_traffic_cost?: number
  is_new?: number
  is_up?: number
  is_down?: number
  is_lost?: number
}

export type DomainRankOverviewResult = {
  target: string
  location_code: number
  language_code: string
  total_count: number
  items_count: number
  items: Array<{
    se_type: string
    location_code: number
    language_code: string
    metrics: {
      organic?: DomainRankMetrics
      paid?: DomainRankMetrics
      local_pack?: DomainRankMetrics
      featured_snippet?: DomainRankMetrics
    }
  }>
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchDomainRankOverview(
  input: DomainRankOverviewInput
): Promise<DomainRankOverviewResult | null> {
  const task = {
    target: input.target,
    ...locationTask(input),
    language_code: input.languageCode ?? "en",
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<DomainRankOverviewResult>>(
    "/v3/dataforseo_labs/google/domain_rank_overview/live",
    [task]
  )

  return extractFirstResult(data, "domain_rank_overview")
}
