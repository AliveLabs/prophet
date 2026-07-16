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

export type ProviderCandidate = {
  providerEntityId: string
  name: string
  category?: string
  distanceMeters?: number
  rating?: number
  reviewCount?: number
  raw: unknown
}

export interface Provider {
  name: string
  fetchCompetitorsNear(input: {
    lat: number
    lng: number
    radiusMeters: number
    query?: string
    category?: string
    city?: string
    region?: string
  }): Promise<ProviderCandidate[]>
  fetchSnapshot(input: { providerEntityId: string }): Promise<unknown>
  normalizeSnapshot(raw: unknown): NormalizedSnapshot
}
