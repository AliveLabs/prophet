// ---------------------------------------------------------------------------
// DataForSEO Labs – Historical Rank Overview (Live)
// Docs: https://docs.dataforseo.com/v3/dataforseo_labs/google/historical_rank_overview/live
// ---------------------------------------------------------------------------

import { postDataForSEO, extractFirstResult, type DataForSEOTaskResponse } from "./client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HistoricalRankOverviewInput = {
  target: string
  locationCode?: number
  languageCode?: string
  dateFrom?: string // "YYYY-MM-DD"
  dateTo?: string   // "YYYY-MM-DD"
}

export type HistoricalRankMonthlyItem = {
  year?: number
  month?: number
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
    is_new?: number
    is_up?: number
    is_down?: number
    is_lost?: number
  }
}

export type HistoricalRankOverviewResult = {
  target?: string
  location_code?: number
  language_code?: string
  total_count?: number
  items_count?: number
  items?: HistoricalRankMonthlyItem[]
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchHistoricalRankOverview(
  input: HistoricalRankOverviewInput
): Promise<HistoricalRankOverviewResult | null> {
  // Default to last 12 months
  const now = new Date()
  const yearAgo = new Date(now)
  yearAgo.setMonth(yearAgo.getMonth() - 12)

  const task: Record<string, unknown> = {
    target: input.target,
    location_code: input.locationCode ?? 2840,
    language_code: input.languageCode ?? "en",
  }

  if (input.dateFrom) task.date_from = input.dateFrom
  else task.date_from = yearAgo.toISOString().slice(0, 10)

  if (input.dateTo) task.date_to = input.dateTo
  else task.date_to = now.toISOString().slice(0, 10)

  const data = await postDataForSEO<DataForSEOTaskResponse<HistoricalRankOverviewResult>>(
    "/v3/dataforseo_labs/google/historical_rank_overview/live",
    [task]
  )

  return extractFirstResult(data, "historical_rank_overview")
}
