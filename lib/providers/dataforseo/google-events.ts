// ---------------------------------------------------------------------------
// DataForSEO – Google Events SERP (Live Advanced)
// ---------------------------------------------------------------------------

import type {
  DataForSEOEventItem,
  DataForSEOEventsResponse,
} from "@/lib/events/types"
import { postDataForSEO } from "./client"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type FetchGoogleEventsInput = {
  keyword: string // e.g. "events"
  locationName: string // "City,State,United States"
  dateRange?: "today" | "tomorrow" | "week" | "weekend" | "next_week" | "month" | "next_month"
  depth?: number // defaults to 10
}

export type FetchGoogleEventsResult = {
  items: DataForSEOEventItem[]
  keyword: string
  dateRange: string
}

/**
 * Calls DataForSEO Google Events SERP Live Advanced endpoint.
 * Returns raw event items for downstream normalization.
 *
 * Docs: https://docs.dataforseo.com/v3/serp-google-events-live-advanced/
 */
export async function fetchGoogleEvents(
  input: FetchGoogleEventsInput
): Promise<FetchGoogleEventsResult> {
  const depth = Math.min(input.depth ?? 10, 20) // hard cap at 20

  const task = {
    keyword: input.keyword,
    location_name: input.locationName,
    language_code: "en",
    device: "desktop",
    os: "windows",
    depth,
    ...(input.dateRange ? { date_range: input.dateRange } : {}),
  }

  const data = await postDataForSEO<DataForSEOEventsResponse>(
    "/v3/serp/google/events/live/advanced",
    [task]
  )

  const taskResult = data.tasks?.[0]
  if (taskResult?.status_code && taskResult.status_code !== 20000) {
    throw new Error(
      `DataForSEO events error: ${taskResult.status_code} ${taskResult.status_message ?? ""}`
    )
  }

  const items = taskResult?.result?.[0]?.items ?? []

  return {
    items,
    keyword: input.keyword,
    dateRange: input.dateRange ?? "all",
  }
}
