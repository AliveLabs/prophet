// ---------------------------------------------------------------------------
// DataForSEO – SERP Google Organic Live Advanced
// Docs: https://docs.dataforseo.com/v3/serp-se-type-live-advanced/
// ---------------------------------------------------------------------------

import { postDataForSEO, type DataForSEOTaskResponse } from "./client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SerpOrganicInput = {
  keyword: string
  locationCode?: number
  languageCode?: string
  device?: "desktop" | "mobile"
  depth?: number // default 10 (1 page)
}

export type SerpOrganicItem = {
  type?: string // "organic", "paid", "local_pack", etc.
  rank_group?: number
  rank_absolute?: number
  position?: string
  domain?: string
  url?: string
  title?: string
  description?: string
  breadcrumb?: string
  is_paid?: boolean
  highlighted?: string[]
}

export type SerpOrganicResult = {
  keyword: string
  type?: string
  se_domain?: string
  location_code?: number
  language_code?: string
  check_url?: string
  datetime?: string
  item_types?: string[]
  items_count?: number
  items: SerpOrganicItem[]
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchSerpOrganic(
  input: SerpOrganicInput
): Promise<SerpOrganicResult | null> {
  const task = {
    keyword: input.keyword,
    location_code: input.locationCode ?? 2840,
    language_code: input.languageCode ?? "en",
    device: input.device ?? "desktop",
    depth: input.depth ?? 10,
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<SerpOrganicResult>>(
    "/v3/serp/google/organic/live/advanced",
    [task]
  )

  const taskResult = data.tasks?.[0]
  if (taskResult?.status_code && taskResult.status_code !== 20000) {
    throw new Error(
      `DataForSEO SERP organic error: ${taskResult.status_code} ${taskResult.status_message ?? ""}`
    )
  }

  return taskResult?.result?.[0] ?? null
}
