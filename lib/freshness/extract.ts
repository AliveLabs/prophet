// ---------------------------------------------------------------------------
// content_as_of extractors (Spine rewrite · Phase 1)
//
// Derive the REAL recency of a snapshot's content from its raw_data, per signal.
// Social is the headline case (newest post date); for signals whose data is
// inherently "as of when we fetched" (listing/menu/seo/events/weather/traffic),
// content_as_of == captured_at and read-time staleness is just capture age.
//
// Defensively handles BOTH the normalized social shape (recentPosts[].createdTime)
// and the legacy edge-path raw shape (created_time / unix timestamp), so the 42%
// of "undated" rows the audit found get a date wherever one exists.
// ---------------------------------------------------------------------------

import type { SignalKind } from "./contract"

export type Extracted = { contentAsOf: string | null; isEmpty: boolean }

type AnyRec = Record<string, unknown>

/** Best-effort publish date for a single social post across normalized + raw shapes. */
function postDate(post: AnyRec): string | null {
  const stringFields = ["createdTime", "created_time", "taken_at", "date", "create_time"]
  for (const f of stringFields) {
    const v = post[f]
    if (typeof v === "string" && v.trim()) return v
  }
  const tsFields = ["timestamp", "taken_at_timestamp", "create_time"]
  for (const f of tsFields) {
    const v = post[f]
    if (typeof v === "number" && v > 0) {
      // Heuristic: seconds vs milliseconds.
      const ms = v < 1e12 ? v * 1000 : v
      return new Date(ms).toISOString()
    }
  }
  return null
}

/** Newest post date inside a social snapshot. isEmpty when the profile has no posts. */
export function socialContentAsOf(raw: AnyRec | null | undefined): Extracted {
  if (!raw) return { contentAsOf: null, isEmpty: true }
  const posts =
    (raw.recentPosts as AnyRec[] | undefined) ??
    (raw.recent_posts as AnyRec[] | undefined) ??
    ((raw.data as AnyRec | undefined)?.items as AnyRec[] | undefined) ??
    []
  if (!Array.isArray(posts) || posts.length === 0) return { contentAsOf: null, isEmpty: true }

  const times = posts
    .map(postDate)
    .filter((d): d is string => !!d)
    .map((d) => Date.parse(d))
    .filter((n) => !Number.isNaN(n))

  if (times.length === 0) return { contentAsOf: null, isEmpty: false } // posts exist but carry no date
  return { contentAsOf: new Date(Math.max(...times)).toISOString(), isEmpty: false }
}

/** Newest review date, when reviews carry absolute dates. */
export function reviewsContentAsOf(reviews: Array<{ date?: string | null }> | null | undefined): Extracted {
  if (!reviews || reviews.length === 0) return { contentAsOf: null, isEmpty: reviews?.length === 0 }
  const times = reviews
    .map((r) => r.date)
    .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
    .map((d) => Date.parse(d))
    .filter((n) => !Number.isNaN(n)) // relative strings ("2 weeks ago") drop out → undated, honestly
  if (times.length === 0) return { contentAsOf: null, isEmpty: false }
  return { contentAsOf: new Date(Math.max(...times)).toISOString(), isEmpty: false }
}

/**
 * For signals whose payload is inherently "as of when we fetched it" (listing, menu,
 * SEO, events search, weather, traffic), content_as_of == captured_at. Read-time
 * staleness then falls out of capture age via classifyNow.
 */
export function captureAsContent(capturedAt: string): Extracted {
  return { contentAsOf: capturedAt, isEmpty: false }
}

/** Dispatch by signal kind; social/reviews have real content dates, the rest use capture. */
export function extractContentAsOf(kind: SignalKind, raw: AnyRec | null | undefined, capturedAt: string): Extracted {
  switch (kind) {
    case "social":
      return socialContentAsOf(raw)
    case "reviews":
      return reviewsContentAsOf((raw?.recentReviews ?? raw?.reviews) as Array<{ date?: string | null }> | undefined)
    default:
      return captureAsContent(capturedAt)
  }
}
