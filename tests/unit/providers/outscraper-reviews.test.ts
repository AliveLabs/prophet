// Review-backfill: the Outscraper review normalizer. Pins the KEY PARITY with the
// daily Places capture (source_review_id + author_key shapes) — if these drift, the
// exact upsert dedup silently splits rows/reviewers across the two capture paths.

import { describe, it, expect } from "vitest"
import { normalizeOutscraperReview } from "@/lib/providers/outscraper"

const PLACE = "ChIJabc123"

describe("normalizeOutscraperReview", () => {
  it("maps a full review to the same key space as the Places capture", () => {
    const c = normalizeOutscraperReview(PLACE, {
      review_id: "rev_9",
      author_id: "auth_7",
      author_title: "Jane D.",
      review_rating: 4,
      review_timestamp: 1_760_000_000,
      review_text: "  Great patio  ",
      review_link: "https://maps.google.com/x",
    })
    expect(c.sourceReviewId).toBe(`places/${PLACE}/reviews/rev_9`)
    expect(c.authorKey).toBe("uri:https://www.google.com/maps/contrib/auth_7/reviews")
    expect(c.authorName).toBe("Jane D.")
    expect(c.rating).toBe(4)
    expect(c.text).toBe("Great patio") // trimmed
    expect(c.publishedAt).toBe(new Date(1_760_000_000 * 1000).toISOString())
    expect(c.googleMapsUri).toBe("https://maps.google.com/x")
    expect(c.relativePublished).toBeNull()
  })

  it("falls back to a normalized name key when there is no author id", () => {
    const c = normalizeOutscraperReview(PLACE, { review_id: "r", author_title: "  Bob   Smith " })
    expect(c.authorKey).toBe("name:bob smith")
    expect(c.authorName).toBe("Bob   Smith") // author_name keeps original spacing; only the KEY is normalized
  })

  it("yields a null author key when there is neither id nor name", () => {
    const c = normalizeOutscraperReview(PLACE, { review_id: "r" })
    expect(c.authorKey).toBeNull()
    expect(c.authorName).toBeNull()
  })

  it("nulls out-of-range or missing ratings rather than guessing", () => {
    expect(normalizeOutscraperReview(PLACE, { review_id: "r", review_rating: 0 }).rating).toBeNull()
    expect(normalizeOutscraperReview(PLACE, { review_id: "r", review_rating: 9 }).rating).toBeNull()
    expect(normalizeOutscraperReview(PLACE, { review_id: "r" }).rating).toBeNull()
    expect(normalizeOutscraperReview(PLACE, { review_id: "r", review_rating: 4.6 }).rating).toBe(5) // rounds
  })

  it("nulls published_at when the timestamp is missing or zero", () => {
    expect(normalizeOutscraperReview(PLACE, { review_id: "r", review_timestamp: 0 }).publishedAt).toBeNull()
    expect(normalizeOutscraperReview(PLACE, { review_id: "r" }).publishedAt).toBeNull()
  })

  it("nulls whitespace-only review text", () => {
    expect(normalizeOutscraperReview(PLACE, { review_id: "r", review_text: "   " }).text).toBeNull()
  })
})
