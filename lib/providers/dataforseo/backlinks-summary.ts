// ---------------------------------------------------------------------------
// DataForSEO Backlinks – Summary (Live)
// Docs: https://docs.dataforseo.com/v3/backlinks/summary/live
// ---------------------------------------------------------------------------

import { postDataForSEO, extractFirstResult, type DataForSEOTaskResponse } from "./client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BacklinksSummaryInput = {
  target: string
  includeSubdomains?: boolean
}

export type BacklinksSummaryResult = {
  target: string
  total_count?: number
  items_count?: number
  items?: BacklinksSummaryItem[]
}

export type BacklinksSummaryItem = {
  target?: string
  rank?: number // domain trust / authority score (0-1000)
  backlinks?: number
  backlinks_spam_score?: number
  broken_backlinks?: number
  referring_domains?: number
  referring_domains_nofollow?: number
  referring_main_domains?: number
  referring_main_domains_nofollow?: number
  referring_ips?: number
  referring_subnets?: number
  referring_pages?: number
  referring_links_tld?: Record<string, number>
  referring_links_types?: Record<string, number>
  referring_links_attributes?: Record<string, number>
  referring_links_platform_types?: Record<string, number>
  referring_links_semantic_locations?: Record<string, number>
  external_links?: number
  internal_links?: number
  info?: {
    server?: string
    cms?: string
    platform_type?: string[]
    ip_address?: string
    country?: string
    is_ip?: boolean
    target_spam_score?: number
  }
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export async function fetchBacklinksSummary(
  input: BacklinksSummaryInput
): Promise<BacklinksSummaryItem | null> {
  const task = {
    target: input.target,
    include_subdomains: input.includeSubdomains ?? true,
    backlinks_status_type: "live",
    internal_list_limit: 10,
  }

  const data = await postDataForSEO<DataForSEOTaskResponse<BacklinksSummaryResult>>(
    "/v3/backlinks/summary/live",
    [task]
  )

  const result = extractFirstResult(data, "backlinks_summary")
  return result?.items?.[0] ?? null
}
