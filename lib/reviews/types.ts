// ---------------------------------------------------------------------------
// Review Intelligence (ALT-347..355) — shared contracts.
// One row per customer review seen in the own-location Google Places feed,
// persisted + accumulated by lib/reviews/store.ts, scored (fail-soft, never
// fabricated) by lib/reviews/scoring.ts, mapped to a recommended action by
// lib/reviews/make-good.ts, and triaged on /reviews.
//
// GUARDRAIL (Bryan, 2026-07-16): authenticity/severity prioritize and improve
// RESPONSES. Nothing here recommends removal or coaches removal-gaming.
// ---------------------------------------------------------------------------

/** A review as captured from the provider feed (pre-scoring). */
export type CapturedReview = {
  sourceReviewId: string
  authorName?: string | null
  /** Reviewer identity for within-our-data aggregates: authorAttribution.uri
   *  when present, else normalized display name. NOT a cross-platform id. */
  authorKey?: string | null
  rating?: number | null
  text?: string | null
  /** Absolute RFC3339 publish time when the provider supplies it. */
  publishedAt?: string | null
  /** Provider's relative description ("3 weeks ago") — display fallback. */
  relativePublished?: string | null
  googleMapsUri?: string | null
}

/** A persisted location_reviews row (loose-cast until types regen, like insight_pool). */
export type LocationReviewRow = {
  id: string
  location_id: string
  source: string
  source_review_id: string
  author_name: string | null
  author_key: string | null
  rating: number | null
  review_text: string | null
  published_at: string | null
  relative_published: string | null
  google_maps_uri: string | null
  first_seen_at: string
  last_seen_at: string
  authenticity_score: number | null
  authenticity_confidence: "low" | "medium" | "high" | null
  authenticity_rationale: string | null
  severity_score: number | null
  severity_rationale: string | null
  /** -100 (furious/hostile) .. 0 (neutral) .. +100 (delighted). Null until ri-v2 scores it. */
  sentiment_score: number | null
  red_flags: string[] | null
  scored_at: string | null
  score_version: string | null
  triage_status: "open" | "responded" | "dismissed"
  triage_updated_at: string | null
  operator_verdict: "genuine" | "not_genuine" | null
  operator_verdict_at: string | null
  draft_text: string | null
  draft_generated_at: string | null
}

/** Per-review output of the batched scoring pass (ALT-348 + ALT-350). */
export type ReviewScore = {
  sourceReviewId: string
  /** 0 (almost certainly not a genuine customer account of a visit) .. 100. */
  authenticityScore: number
  authenticityConfidence: "low" | "medium" | "high"
  /** Short, operator-safe rationale (shown behind a "Why" rolldown). */
  authenticityRationale: string
  /** 0 (mild) .. 100 (crisis-grade). How serious/heated the complaint is. */
  severityScore: number
  severityRationale: string
  /** -100 (furious/hostile) .. 0 (neutral) .. +100 (delighted). */
  sentimentScore: number
  /** Matched red-flag categories (illness, discrimination, safety), if any. */
  redFlags: string[]
}

/** Within-our-data reviewer signals (ALT-349) — pure aggregates, no LLM. */
export type ReviewerSignals = {
  /** Reviews by this author_key on this location, in our corpus. */
  reviewCount: number
  /** Share of this author's reviews here that are ≤2 stars. */
  negativeShare: number
  /** True when several reviews from this author landed in a short window. */
  bursty: boolean
}

/** Bands derived from scores — the ONLY vocabulary the UI speaks (no raw numbers). */
export type GenuinenessBand = "genuine" | "caution" | "suspect"
export type SeverityBand = "mild" | "serious" | "crisis"
/** Display/sort band from sentiment (crisis routing stays on red_flags/severity). */
export type SentimentBand = "negative" | "neutral" | "positive"

/** Recommended action tier (ALT-352). Recommendation only — operator executes. */
export type MakeGoodTier = "respond" | "discount" | "comp"

/** Concrete make-good ladder (ALT-361). "none" = reply only. Rungs escalate with
 *  severity x generosity; doubtful genuineness caps one rung DOWN (a serial
 *  complainer might get their meal replaced, never a refund); suspect gets none. */
export type Remediation = "none" | "replace_side" | "treat" | "replace_meal" | "refund_and_replace"

export type MakeGoodRecommendation = {
  tier: MakeGoodTier
  /** Concrete suggested make-good (drives the draft's offer when enabled). */
  remediation: Remediation
  /** Operator-facing one-liner explaining the recommendation. */
  rationale: string
  /** True when a red flag routed this to owner attention. */
  ownerAttention: boolean
}
