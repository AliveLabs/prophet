// ---------------------------------------------------------------------------
// DataForSEO Labs – Domain Intersection (Live)
// Docs: https://docs.dataforseo.com/v3/dataforseo_labs-google-domain_intersection-live/
// ---------------------------------------------------------------------------

import { postDataForSEO, extractFirstResult, type DataForSEOTaskResponse } from "./client"
import { locationTask } from "./location-scope"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DomainIntersectionInput = {
  target1: string // primary domain
  target2: string // competitor domain
  itemTypes?: string[] // ["organic","paid"] etc.
  /** ALT-636: the location's own market, "City,Region,United States". Takes precedence
   *  over locationCode. Exactly one reaches the wire; see locationTask(). */
  locationName?: string
  locationCode?: number
  languageCode?: string
  limit?: number
}

export type DomainIntersectionItem = {
  keyword_data?: {
    keyword?: string
    keyword_info?: {
      search_volume?: number
      competition?: number
      competition_level?: string
      cpc?: number
    }
  }
  first_domain_serp_element?: {
    se_type?: string
    serp_item?: {
      type?: string
      rank_group?: number
      rank_absolute?: number
      position?: string
      url?: string
      is_paid?: boolean
    }
  }
  second_domain_serp_element?: {
    se_type?: string
    serp_item?: {
      type?: string
      rank_group?: number
      rank_absolute?: number
      position?: string
      url?: string
      is_paid?: boolean
    }
  }
}

export type DomainIntersectionResult = {
  total_count: number
  items_count: number
  items: DomainIntersectionItem[]
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchDomainIntersection(
  input: DomainIntersectionInput
): Promise<DomainIntersectionResult | null> {
  const task: Record<string, unknown> = {
    target1: input.target1,
    target2: input.target2,
    ...locationTask(input),
    language_code: input.languageCode ?? "en",
    limit: input.limit ?? 50,
  }

  if (input.itemTypes?.length) {
    task.item_types = input.itemTypes
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<DomainIntersectionResult>>(
    "/v3/dataforseo_labs/google/domain_intersection/live",
    [task]
  )

  return extractFirstResult(data, "domain_intersection")
}
