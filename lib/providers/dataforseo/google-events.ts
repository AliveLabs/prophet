// ---------------------------------------------------------------------------
// DataForSEO – Google Events SERP (Live Advanced)
// ---------------------------------------------------------------------------

import type {
  DataForSEOEventItem,
  DataForSEOEventsResponse,
} from "@/lib/events/types"
import { postDataForSEO, DataForSEOError } from "./client"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type FetchGoogleEventsInput = {
  keyword: string // e.g. "events"
  locationName: string // "City,State,United States"
  dateRange?: "today" | "tomorrow" | "week" | "weekend" | "next_week" | "month" | "next_month"
  depth?: number // defaults to 10
  /** Restaurant GPS — used to FALL BACK to location_coordinate when DataForSEO doesn't recognize the
   *  city name (some smaller cities aren't in its events location list → 40501 Invalid Field). */
  lat?: number | null
  lng?: number | null
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
/**
 * Event probe keywords are cataloged VENUE NAMES used verbatim (see lib/events/keywords.ts). DataForSEO
 * rejects some characters in the keyword field with a task-level 40501 "Invalid Field" — observed on the
 * venue "McKinney North Football/Soccer Auxiliary Field" (the "/" trips it), which silently dropped that
 * probe to a partial run. Normalize structural separators (/ \ | < >) to spaces, collapse whitespace, and
 * cap length, keeping the search intent (letters/digits/&/-/'/.,()/spaces survive). (2026-06-25.)
 */
export function sanitizeEventKeyword(keyword: string): string {
  return keyword.replace(/[/\\|<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)
}

export async function fetchGoogleEvents(
  input: FetchGoogleEventsInput
): Promise<FetchGoogleEventsResult> {
  const depth = Math.min(input.depth ?? 10, 20) // hard cap at 20

  const baseTask = {
    keyword: sanitizeEventKeyword(input.keyword),
    language_code: "en",
    device: "desktop",
    os: "windows",
    depth,
    ...(input.dateRange ? { date_range: input.dateRange } : {}),
  }

  // DataForSEO requires exactly ONE of location_name | location_coordinate | location_code.
  const callEvents = async (locationField: Record<string, string>) => {
    const data = await postDataForSEO<DataForSEOEventsResponse>("/v3/serp/google/events/live/advanced", [
      { ...baseTask, ...locationField },
    ])
    return data.tasks?.[0]
  }

  let taskResult = await callEvents({ location_name: input.locationName })

  // LOCATION FALLBACK (2026-06-25): some cities aren't in DataForSEO's events location list — e.g.
  // "McKinney,Texas,United States" returns 40501 "Invalid Field: 'location_name'" while Forney/Arlington/
  // Richardson resolve fine. A GPS coordinate is ALWAYS valid (no name lookup), and we have lat/lng for
  // every location, so retry with location_coordinate. Working locations (valid names) never reach this.
  const nameRejected =
    taskResult?.status_code === 40501 && /location_name/i.test(taskResult?.status_message ?? "")
  if (nameRejected && input.lat != null && input.lng != null) {
    // "latitude,longitude,radius" — radius within DataForSEO's accepted bound; coordinate-centered on the
    // restaurant is also MORE relevant for local events than a city-wide name.
    taskResult = await callEvents({ location_coordinate: `${input.lat},${input.lng},40000` })
  }

  if (taskResult?.status_code && taskResult.status_code !== 20000) {
    // 40102 = "No Search Results" — NOT an error, just no events for this keyword/location (DataForSEO's
    // benign no-data code; mirrors ads-search.ts). Many locations legitimately have no events. Returning
    // empty here (instead of throwing a DataForSEOError) keeps a benign empty from being stamped as a
    // vendor-failure signal — which the fleet health detector was reading as a fleet-wide DataForSEO
    // outage and firing the daily "pipeline watchdog: degraded" alert on. (2026-06-25.)
    if (taskResult.status_code === 40102) {
      return { items: [], keyword: input.keyword, dateRange: input.dateRange ?? "all" }
    }
    // Typed so a task-level credit/cost-limit code (40200/40201/40203/40210) is detectable as a
    // vendor outage by the worker (instanceof), not just an HTTP 402. Mirrors extractFirstResult.
    throw new DataForSEOError(
      `DataForSEO events error: ${taskResult.status_code} ${taskResult.status_message ?? ""}`,
      undefined,
      taskResult.status_code,
    )
  }

  const items = taskResult?.result?.[0]?.items ?? []

  return {
    items,
    keyword: input.keyword,
    dateRange: input.dateRange ?? "all",
  }
}
