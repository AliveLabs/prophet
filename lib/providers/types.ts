export type NormalizedSnapshot = {
  version: "1.0"
  timestamp: string
  profile?: {
    title?: string
    rating?: number
    reviewCount?: number
    priceLevel?: string
    address?: string
    website?: string
    phone?: string
  }
  hours?: Record<string, string>
  // ALT-347: optional identity/timestamp fields are ADDITIVE — existing consumers keep
  // reading id/rating/text/date; the review persistence path (lib/reviews/store.ts)
  // reads the richer fields when the provider supplies them.
  recentReviews?: Array<{
    id: string
    rating: number
    text: string
    date: string
    sourceReviewId?: string
    authorName?: string
    authorUri?: string
    publishedAt?: string
    googleMapsUri?: string
  }>
  attributes?: Record<string, unknown>
  source_raw?: unknown
}

// The `Provider` interface + `ProviderCandidate` type (and the geminiProvider /
// dataForSeoProvider implementations behind getProvider()) were deleted 2026-08-12: the
// discovery path was rewritten to Places searchNearby + a Sonnet rerank
// (lib/competitors/discover.ts) and nothing called getProvider() anymore. NormalizedSnapshot
// stays — it is the snapshot shape the insights pipeline, dossier, and review store all read.
