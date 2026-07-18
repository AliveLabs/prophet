import { fetchWithRetry } from "@/lib/http/fetch-with-retry"
import type { CapturedReview } from "@/lib/reviews/types"

const BASE_URL = "https://api.app.outscraper.com/maps/search-v3"
const REVIEWS_URL = "https://api.app.outscraper.com/maps/reviews-v3"

function getApiKey(): string {
  const key = process.env.OUTSCRAPER_API_KEY
  if (!key || key === "xxx") throw new Error("OUTSCRAPER_API_KEY is not configured")
  return key
}

export type BusyTimesDay = {
  day_of_week: number
  day_name: string
  hourly_scores: number[]
  peak_hour: number
  peak_score: number
  slow_hours: number[]
}

export type BusyTimesResult = {
  competitor_id: string
  days: BusyTimesDay[]
  typical_time_spent: string | null
  current_popularity: number | null
  /** ALT-264 — the place's posted hours, as "Day: span" lines (parseable by
   *  lib/competitors/open-hours). The same paid pull carries them; null when absent. */
  working_hours_lines: string[] | null
}

/** ALT-264 — normalize Outscraper's `working_hours` (an object keyed by day name,
 *  values like "11AM-10PM", "Open 24 hours", or occasionally an array of spans)
 *  into "Day: span" lines the open-hours parser reads. Null when unusable. */
export function workingHoursToLines(wh: unknown): string[] | null {
  if (!wh || typeof wh !== "object" || Array.isArray(wh)) return null
  const lines: string[] = []
  for (const [day, span] of Object.entries(wh as Record<string, unknown>)) {
    const text = Array.isArray(span)
      ? span.filter((s): s is string => typeof s === "string" && s.trim() !== "").join(", ")
      : typeof span === "string"
        ? span
        : ""
    if (!text.trim()) continue
    lines.push(`${day}: ${text.trim()}`)
  }
  return lines.length > 0 ? lines : null
}

type OutscraperHourEntry = {
  hour: number
  percentage: number
  time?: string
  title?: string
}

type OutscraperDayEntry = {
  day: number
  day_text: string
  popular_times: OutscraperHourEntry[]
}

type OutscraperCurrentEntry = {
  day?: number
  percentage?: number
  time?: string
  title?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OutscraperPlace = Record<string, any>

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function outscraperDayToWeekday(outsDay: number): number {
  // Outscraper uses 7=Sunday, 1=Monday..6=Saturday
  return outsDay === 7 ? 0 : outsDay
}

export async function fetchBusyTimes(
  placeId: string,
  competitorId: string
): Promise<BusyTimesResult | null> {
  const url = new URL(BASE_URL)
  url.searchParams.set("query", placeId)
  url.searchParams.set("limit", "1")
  url.searchParams.set("async", "false")

  const res = await fetchWithRetry(
    url.toString(),
    { headers: { "X-API-KEY": getApiKey() } },
    { timeoutMs: 60_000, label: "outscraper" },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outscraper error ${res.status}: ${text}`)
  }

  const json = await res.json()
  const results = Array.isArray(json) ? json : json?.data
  const place: OutscraperPlace | undefined = Array.isArray(results?.[0])
    ? results[0][0]
    : results?.[0]

  if (!place?.popular_times || !Array.isArray(place.popular_times) || place.popular_times.length === 0) {
    return null
  }

  // Separate day entries from the "current popularity" entry
  const dayEntries: OutscraperDayEntry[] = []
  let currentPopularity: number | null = null

  for (const entry of place.popular_times) {
    if (entry.day_text && Array.isArray(entry.popular_times)) {
      dayEntries.push(entry as OutscraperDayEntry)
    } else if (entry.percentage != null && entry.title) {
      currentPopularity = (entry as OutscraperCurrentEntry).percentage ?? null
    }
  }

  if (dayEntries.length === 0) return null

  const days: BusyTimesDay[] = dayEntries.map((dayEntry) => {
    // Build a 24-slot array from the hourly entries
    const scores = Array(24).fill(0)
    for (const h of dayEntry.popular_times) {
      if (h.hour >= 0 && h.hour < 24) {
        scores[h.hour] = h.percentage ?? 0
      }
    }

    const peakScore = Math.max(...scores)
    const peakHour = scores.indexOf(peakScore)
    const slowHours = scores
      .map((s: number, i: number) => (s > 0 && s < 25 ? i : -1))
      .filter((i: number) => i >= 0)

    const dayName = dayEntry.day_text || DAY_NAMES[outscraperDayToWeekday(dayEntry.day)] || "Unknown"

    return {
      day_of_week: outscraperDayToWeekday(dayEntry.day),
      day_name: dayName,
      hourly_scores: scores,
      peak_hour: peakHour,
      peak_score: peakScore,
      slow_hours: slowHours,
    }
  })

  return {
    competitor_id: competitorId,
    days,
    typical_time_spent: place.time_spent ?? null,
    current_popularity: currentPopularity,
    working_hours_lines: workingHoursToLines(place.working_hours),
  }
}

// ---------------------------------------------------------------------------
// Reviews (maps/reviews-v3). Google Places Details caps at 5 "most relevant"
// reviews per fetch; this pulls a place's real review history (negatives
// included). Canonical impl for BOTH the weekly backfill cron
// (lib/jobs/backfill/reviews-refresh) and the manual ops script
// (scripts/ops/backfill-reviews.mts).
// ---------------------------------------------------------------------------

type OutscraperReview = {
  review_id?: string
  author_id?: string
  author_title?: string
  review_rating?: number
  review_timestamp?: number
  review_text?: string
  review_link?: string
}

/** Map one Outscraper review to a CapturedReview under the SAME key space as the
 *  daily Places capture: source_review_id = places/{placeId}/reviews/{review_id},
 *  author_key = uri:.../contrib/{author_id}/reviews (else normalized name). This
 *  exact parity is what lets upsertLocationReviews dedup the two paths instead of
 *  splitting rows or reviewer identities. Exported for unit tests. */
export function normalizeOutscraperReview(placeId: string, r: OutscraperReview): CapturedReview {
  const authorName = (r.author_title ?? "").trim() || null
  const authorKey = r.author_id
    ? `uri:https://www.google.com/maps/contrib/${r.author_id}/reviews`
    : authorName
      ? `name:${authorName.toLowerCase().replace(/\s+/g, " ")}`
      : null
  const rating =
    typeof r.review_rating === "number" && r.review_rating >= 1 && r.review_rating <= 5
      ? Math.round(r.review_rating)
      : null
  const publishedAt =
    typeof r.review_timestamp === "number" && r.review_timestamp > 0
      ? new Date(r.review_timestamp * 1000).toISOString()
      : null
  return {
    sourceReviewId: `places/${placeId}/reviews/${r.review_id}`,
    authorName,
    authorKey,
    rating,
    text: (r.review_text ?? "").trim() || null,
    publishedAt,
    relativePublished: null, // reviews-v3 gives an absolute timestamp; UI falls back to the date
    googleMapsUri: r.review_link ?? null,
  }
}

/** Pull real Google review history for a place (sync mode). `limit` is capped at
 *  Outscraper's practical 250; reviews without a stable id are dropped (we never
 *  synthesize an upsert key). Returns normalized rows ready for
 *  upsertLocationReviews plus the place's total review count for logging. */
export async function fetchLocationReviews(
  placeId: string,
  opts: { limit?: number; sort?: "newest" | "most_relevant" } = {},
): Promise<{ captured: CapturedReview[]; totalReviews: number | null; name: string | null }> {
  const limit = Math.min(250, Math.max(1, opts.limit ?? 50))
  const sort = opts.sort ?? "newest"
  const url = new URL(REVIEWS_URL)
  url.searchParams.set("query", placeId)
  url.searchParams.set("reviewsLimit", String(limit))
  url.searchParams.set("sort", sort)
  url.searchParams.set("async", "false")

  const res = await fetchWithRetry(
    url.toString(),
    { headers: { "X-API-KEY": getApiKey() } },
    { timeoutMs: 120_000, label: "outscraper-reviews" },
  )
  if (!res.ok) {
    throw new Error(`Outscraper reviews ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const payload = (await res.json()) as {
    data?: Array<{ reviews_data?: OutscraperReview[]; reviews?: number; name?: string }>
  }
  const place = payload.data?.[0]
  const captured = (place?.reviews_data ?? [])
    .filter((r) => typeof r.review_id === "string" && r.review_id.length > 0)
    .map((r) => normalizeOutscraperReview(placeId, r))
  return {
    captured,
    totalReviews: typeof place?.reviews === "number" ? place.reviews : null,
    name: place?.name ?? null,
  }
}
