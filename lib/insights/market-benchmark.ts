// ---------------------------------------------------------------------------
// "Market vs. you" — one honest comparative line (beta rescue Phase 3.2).
//
// Arithmetic over values the pipelines already stored. ZERO MODEL CALLS: a median, a
// subtraction, and a sentence template.
//
// THE FLOOR IS THE WHOLE POINT. A comparison drawn from too little data is worse than no
// comparison, because the operator cannot tell the difference and will act on it. Two gates,
// both enforced in `buildMarketBenchmark`, and BELOW EITHER ONE THIS RETURNS NULL and the
// surface renders nothing:
//
//   MIN_COMPARED_COMPETITORS = 3
//     A median needs a middle. With two, the "median" is the average of the only two rivals
//     we have, and the line reads as a head-to-head call-out of whichever one is worse.
//     Three is the smallest set where the middle value is a real middle.
//
//   MIN_REVIEWS_FOR_COMPARISON = 50, applied to the operator AND to every competitor counted
//     into the median. A star rating on a thin base is noise: at fifty reviews one new
//     one-star review moves a 4.5 by under 0.07, which is below the 0.1 delta this codebase
//     already treats as the smallest reportable rating movement (`lib/insights/rules.ts`).
//     Below fifty, a single guest can flip which side of the median a location sits on.
//     Applying the same floor to both sides keeps the comparison like for like: a rival with
//     eleven reviews and a 5.0 does not get to drag the median.
//
// NEVER A RANKING, NEVER A CAUSE. The line reports two denominated numbers and which side of
// the median the operator sits on. It does not name a single competitor, does not order the
// set, and does not suggest that anything caused anything.
// ---------------------------------------------------------------------------

/** Competitors with a usable rating needed before a median means anything. */
export const MIN_COMPARED_COMPETITORS = 3

/** Reviews behind a rating before that rating is stable enough to compare. Applies to both sides. */
export const MIN_REVIEWS_FOR_COMPARISON = 50

/** Below this gap the operator and the set are reported as level. Matches the smallest rating
 *  movement `lib/insights/rules.ts` is willing to call a change. */
export const RATING_PARITY_BAND = 0.1

/** A location or competitor's stored listing figures. Either field may be missing. */
export type RatedEntity = { rating: number | null; reviewCount: number | null }

export type MarketBenchmark = {
  /** Rounded to one decimal, which is what renders — so the standing word always matches
   *  the numbers the operator can see. */
  ownRating: number
  ownReviewCount: number
  medianRating: number
  /** Competitors that CLEARED the floor and are behind the median, not the tracked total. */
  comparedCount: number
  standing: "above" | "level" | "below"
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** A rating we are willing to compare: present, in range, and backed by enough reviews. */
function usable(entity: RatedEntity, minReviews: number): number | null {
  const { rating, reviewCount } = entity
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating <= 0 || rating > 5) return null
  if (typeof reviewCount !== "number" || !Number.isFinite(reviewCount)) return null
  if (reviewCount < minReviews) return null
  return rating
}

/** Median of a non-empty list. Even lengths average the two middles. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The benchmark, or NULL when the data cannot support an honest one.
 *
 * Pure. `own` is the operator's stored listing figures; `competitors` is the tracked set,
 * unfiltered (this applies the floor itself, so the caller never has to reproduce it).
 */
export function buildMarketBenchmark(
  own: RatedEntity,
  competitors: readonly RatedEntity[],
  opts: { minCompetitors?: number; minReviews?: number } = {},
): MarketBenchmark | null {
  const minCompetitors = opts.minCompetitors ?? MIN_COMPARED_COMPETITORS
  const minReviews = opts.minReviews ?? MIN_REVIEWS_FOR_COMPARISON

  const ownRating = usable(own, minReviews)
  if (ownRating === null || own.reviewCount === null) return null

  const compRatings = competitors
    .map((c) => usable(c, minReviews))
    .filter((r): r is number => r !== null)
  if (compRatings.length < minCompetitors) return null

  const ownR = round1(ownRating)
  const medianR = round1(median(compRatings))
  const gap = round1(ownR - medianR)

  return {
    ownRating: ownR,
    ownReviewCount: own.reviewCount,
    medianRating: medianR,
    comparedCount: compRatings.length,
    standing: gap >= RATING_PARITY_BAND ? "above" : gap <= -RATING_PARITY_BAND ? "below" : "level",
  }
}

// Written for an operator, not an analyst. The earlier draft read "Above the set: your 4.6
// across 812 reviews vs a 4.3 median across 5 tracked competitors" — "the set" is our internal
// word for the competitor group, "median" is a statistics term, and "tracked competitors" is
// our system's vocabulary rather than the operator's. The numbers stay exactly as precise; only
// the framing changed. The middle value is still a median (see `median()` above), we just do not
// make the reader parse the method to read the sentence.
const STANDING_LEAD: Record<MarketBenchmark["standing"], string> = {
  above: "You are rated higher than your competitors",
  level: "You are rated about even with your competitors",
  below: "You are rated lower than your competitors",
}

/** The rendered line. Denominated on both sides, no superlatives, no named rival. */
export function formatBenchmarkLine(benchmark: MarketBenchmark): string {
  const reviews = benchmark.ownReviewCount.toLocaleString("en-US")
  // ALT-726: `comparedCount` is the number of competitors that CLEARED the review floor and went
  // into the median, which the type says explicitly. "You track" claimed it was the tracked total,
  // so an operator watching 8 rivals read "across the 3 you track" and reasonably concluded we had
  // lost five of them.
  const rivals =
    benchmark.comparedCount === 1 ? "1 comparable competitor" : `${benchmark.comparedCount} comparable competitors`
  return (
    `${STANDING_LEAD[benchmark.standing]}: ${benchmark.ownRating.toFixed(1)} from ${reviews} reviews, ` +
    `against ${benchmark.medianRating.toFixed(1)} across ${rivals}.`
  )
}

// ── stored-value resolution ───────────────────────────────────────────────────────────

/**
 * A competitor's rating and review count, from whichever stored source has them.
 *
 * Same precedence the Competitors page uses (`app/(dashboard)/operator-data.ts`, ALT-186):
 * the freshest persisted listing snapshot wins, then `metadata.placeDetails`, then top-level
 * `metadata` — the last of which is where the discover-then-approve flow puts the rating.
 * The two surfaces must agree, so this deliberately mirrors that order rather than inventing
 * a freshness rule of its own. No vendor call: every source here is already in our database.
 */
export function resolveStoredRating(sources: {
  snapshotProfile?: unknown
  placeDetails?: unknown
  metadata?: unknown
}): RatedEntity {
  const pick = (bag: unknown, key: string): number | null => {
    if (!bag || typeof bag !== "object") return null
    const v = (bag as Record<string, unknown>)[key]
    return typeof v === "number" && Number.isFinite(v) ? v : null
  }
  const order = [sources.snapshotProfile, sources.placeDetails, sources.metadata]
  let rating: number | null = null
  let reviewCount: number | null = null
  for (const bag of order) {
    if (rating === null) rating = pick(bag, "rating")
    if (reviewCount === null) reviewCount = pick(bag, "reviewCount") ?? pick(bag, "userRatingCount")
  }
  return { rating, reviewCount }
}
