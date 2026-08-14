// ---------------------------------------------------------------------------
// Review watchdog (beta rescue phase 4.2): THE DETECTION BAND.
//
// Tells an operator when something about their OWN reviews genuinely moved.
// Pure arithmetic over rows we already store (location_reviews): ZERO model
// calls, no network, no clock of its own. Everything here is a pure function of
// (reviews, now, config) so the whole thing is unit-testable with no DB.
//
// ── THE POSTURE: a watchdog that cries wolf gets muted, which is worse than no
//    watchdog. Every detector therefore has FOUR gates, and all four must pass:
//
//      1. VOLUME:   enough recent AND baseline data for the question to be
//                   answerable at all. Below the floor we stay silent; we never
//                   "downgrade to a hunch".
//      2. EFFECT:   the move must be big enough to matter to a human (stars, or
//                   a rate ratio), not merely detectable.
//      3. EVIDENCE: the move must clear a significance bar against THIS
//                   location's own history, never a global constant.
//      4. HONESTY:  a suppressor for the cases where our own data would lie
//                   (see the capture-staleness guard on droughts).
//
// ── WHY PER-LOCATION, NOT A GLOBAL CONSTANT. lib/insights/rules.ts already has
//    global-threshold rows (rating delta >= 0.1, review count delta >= 2). Those
//    feed the MODEL path, where a skill weighs them against everything else. A
//    watchdog that speaks straight to the operator cannot use them: at 40 reviews
//    a bad week clears 0.1 stars on noise alone, and at 800 reviews a real
//    collapse can hide under it. Significance testing is exactly the tool that
//    makes the same observed move mean different things at different volumes, so
//    that is what this uses.
//
// ── WHY 2.5 SIGMA, NOT 1.96. This runs per location per night across the fleet.
//    At the textbook 95% bar, one location tested nightly throws a false positive
//    roughly every three weeks by construction. 2.5 sigma (about 1.2% two-sided),
//    stacked with an effect floor and the cooldown in selectFiringAnomalies,
//    puts the expected false-fire rate per location in the months, not weeks.
//
// Retuning is an edit to REVIEW_WATCHDOG_CONFIG. Nothing downstream changes.
// ---------------------------------------------------------------------------

/** One review, reduced to what the detectors read. Built by lib/reviews/watch-events.ts. */
export type WatchdogReview = {
  /** 1..5, or null when the provider gave no star rating (still counts for velocity). */
  rating: number | null
  /** Publish time, epoch ms. Rows without a parseable publish time are dropped upstream. */
  publishedAtMs: number
  /** Red-flag categories written by the existing scoring pass (lib/reviews/scoring.ts). */
  redFlags: string[]
}

export type AnomalyKind = "rating_move" | "review_velocity" | "red_flag_cluster"
/** "down" = worse for the operator (rating fell, reviews dried up). A cluster is always "up". */
export type AnomalyDirection = "up" | "down"

export type RatingMoveDetail = {
  windowDays: number
  recentCount: number
  recentMean: number
  baselineCount: number
  baselineMean: number
  /** recentMean - baselineMean, in stars. Signed. */
  deltaStars: number
}

export type VelocityDetail = {
  windowDays: number
  baselineDays: number
  recentCount: number
  /** What this location's own baseline rate predicts for a window this long. */
  expectedCount: number
  /** recentCount / expectedCount. */
  ratio: number
}

export type ClusterDetail = {
  windowDays: number
  /** One of the scoring pass's whitelisted red-flag categories. */
  category: string
  recentCount: number
  /** What this location's own history predicts for a window this long. */
  baselineExpected: number
}

type AnomalyBase = {
  /** Stable dedupe identity. The cooldown in selectFiringAnomalies keys off THIS. */
  key: string
  direction: AnomalyDirection
  /** |z| of the test that fired. Recorded for audit; NEVER shown to an operator. */
  strength: number
  /** Days this key stays suppressed after firing. Always the detector's own window. */
  cooldownDays: number
}

export type ReviewAnomaly =
  | (AnomalyBase & { kind: "rating_move"; detail: RatingMoveDetail })
  | (AnomalyBase & { kind: "review_velocity"; detail: VelocityDetail })
  | (AnomalyBase & { kind: "red_flag_cluster"; detail: ClusterDetail })

// ---------------------------------------------------------------------------
// ★ THE CONFIG ★: every number the watchdog fires on, in one object.
// ---------------------------------------------------------------------------

export type WatchdogConfig = {
  /** Rating: the trailing window under test. Also its cooldown (see COOLDOWN note). */
  ratingRecentDays: number
  /** Rating: the location's own history the recent window is compared against. */
  ratingBaselineDays: number
  /** Rating: reviews needed IN the recent window before the test is run at all. */
  ratingMinRecent: number
  /** Rating: reviews needed in the baseline before it counts as "this location's usual". */
  ratingMinBaseline: number
  /** Rating: the human-meaningful floor, in stars. Below this we stay quiet even at high z. */
  ratingMinDeltaStars: number
  /** Rating: standard-deviation floor. A location with an all-5s baseline has sd 0, which
   *  would make ONE 4-star review infinitely significant. Real star distributions run
   *  sd 1.0 to 1.5; 0.5 is a conservative floor that kills that false-positive class. */
  ratingMinSd: number
  /** Rating: |z| required to fire. */
  ratingZ: number

  /** Velocity: the trailing window whose review COUNT is under test. */
  velocityRecentDays: number
  /** Velocity: history used to estimate this location's own arrival rate. */
  velocityBaselineDays: number
  /** Velocity: reviews needed in the baseline before the rate estimate is trusted. */
  velocityMinBaseline: number
  /** Velocity: expected count in the recent window below which nothing is detectable.
   *  A location that averages one review a month cannot have a distinguishable
   *  "drought" over two weeks, and pretending otherwise is the cry-wolf case. */
  velocityMinExpected: number
  /** Velocity: how far off the usual rate it has to be, as a ratio, in either direction. */
  velocityMinRatio: number
  /** Velocity: |z| required to fire. */
  velocityZ: number
  /** Velocity: if our newest capture is older than this, a DROUGHT is suppressed. Our own
   *  collection gap looks exactly like customers going quiet, and reporting our outage as
   *  the operator's problem is the single most trust-destroying thing this could do. */
  captureStaleDays: number

  /** Cluster: the trailing window red-flag reviews are counted in. */
  clusterWindowDays: number
  /** Cluster: history used to estimate how normal that category is here. */
  clusterBaselineDays: number
  /** Cluster: reviews sharing one category before it is a cluster rather than a coincidence. */
  clusterMinCount: number
  /** Cluster: |z| required when the category is NOT rare for this location. */
  clusterZ: number
}

export const REVIEW_WATCHDOG_CONFIG: WatchdogConfig = {
  ratingRecentDays: 30,
  ratingBaselineDays: 365,
  ratingMinRecent: 8,
  ratingMinBaseline: 30,
  ratingMinDeltaStars: 0.4,
  ratingMinSd: 0.5,
  ratingZ: 2.5,

  velocityRecentDays: 14,
  velocityBaselineDays: 180,
  velocityMinBaseline: 20,
  velocityMinExpected: 4,
  velocityMinRatio: 1.6,
  velocityZ: 2.5,
  captureStaleDays: 3,

  clusterWindowDays: 30,
  clusterBaselineDays: 365,
  clusterMinCount: 3,
  clusterZ: 2,
}

const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Pure statistics. Small on purpose: no dependency, no gamma functions, every
// step checkable by hand from the numbers stored on the event.
// ---------------------------------------------------------------------------

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

/** Sample standard deviation (n-1). Zero for fewer than two points. */
export function sampleSd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let ss = 0
  for (const x of xs) ss += (x - m) * (x - m)
  return Math.sqrt(ss / (xs.length - 1))
}

/**
 * Welch's two-sample statistic on the difference of means, with a standard-deviation
 * floor applied to BOTH samples. Welch (rather than a pooled t) because the recent
 * window is small and its spread is usually wider than the long baseline's, which is
 * exactly the case where equal-variance pooling overstates significance.
 *
 * Read as a z: with the sd floor and a recent-sample floor of 8, the normal
 * approximation is close enough, and erring toward the normal tail is the
 * CONSERVATIVE direction here (t has fatter tails, so t would fire more often).
 */
export function welchZ(recent: number[], baseline: number[], minSd: number): number {
  if (recent.length < 2 || baseline.length < 2) return 0
  const sdR = Math.max(minSd, sampleSd(recent))
  const sdB = Math.max(minSd, sampleSd(baseline))
  const se = Math.sqrt((sdR * sdR) / recent.length + (sdB * sdB) / baseline.length)
  if (!(se > 0)) return 0
  return (mean(recent) - mean(baseline)) / se
}

/**
 * Anscombe's variance-stabilizing transform for a Poisson count: 2*(sqrt(k + 3/8) -
 * sqrt(mu + 3/8)) is approximately standard normal. Counts of arriving reviews are the
 * textbook Poisson case, and this form needs no factorials, handles k = 0 (a total
 * drought) without a special case, and stays honest at the small expected counts a
 * restaurant actually produces.
 */
export function anscombeZ(observed: number, expected: number): number {
  return 2 * (Math.sqrt(observed + 0.375) - Math.sqrt(expected + 0.375))
}

const round2 = (n: number): number => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------
// Windowing
// ---------------------------------------------------------------------------

/** Reviews published inside [nowMs - endDaysAgo*day, nowMs - startDaysAgo*day). */
function inWindow(
  reviews: WatchdogReview[],
  nowMs: number,
  startDaysAgo: number,
  endDaysAgo: number,
): WatchdogReview[] {
  const from = nowMs - endDaysAgo * DAY_MS
  const to = nowMs - startDaysAgo * DAY_MS
  return reviews.filter((r) => r.publishedAtMs >= from && r.publishedAtMs < to)
}

const starsOf = (rows: WatchdogReview[]): number[] =>
  rows.map((r) => r.rating).filter((n): n is number => typeof n === "number" && n >= 1 && n <= 5)

// ---------------------------------------------------------------------------
// Detector 1: RATING MOVEMENT
//
// Question: are this location's recent reviews scoring meaningfully differently
// from its own last year? NOT "did the published running average tick", which at
// 800 reviews lags a collapse by months and at 40 reviews swings on one guest.
// ---------------------------------------------------------------------------

export function detectRatingMove(
  reviews: WatchdogReview[],
  nowMs: number,
  config: WatchdogConfig = REVIEW_WATCHDOG_CONFIG,
): ReviewAnomaly | null {
  const recent = starsOf(inWindow(reviews, nowMs, 0, config.ratingRecentDays))
  const baseline = starsOf(
    inWindow(reviews, nowMs, config.ratingRecentDays, config.ratingRecentDays + config.ratingBaselineDays),
  )

  // GATE 1 (volume). A thin window on either side means we do not know, and
  // "we do not know" is silence, never a softened claim.
  if (recent.length < config.ratingMinRecent) return null
  if (baseline.length < config.ratingMinBaseline) return null

  const recentMean = mean(recent)
  const baselineMean = mean(baseline)
  const deltaStars = recentMean - baselineMean

  // GATE 2 (effect). A 0.1 star drift is real and irrelevant.
  if (Math.abs(deltaStars) < config.ratingMinDeltaStars) return null

  // GATE 3 (evidence), against this location's own spread.
  const z = welchZ(recent, baseline, config.ratingMinSd)
  if (Math.abs(z) < config.ratingZ) return null

  const direction: AnomalyDirection = deltaStars < 0 ? "down" : "up"
  return {
    kind: "rating_move",
    key: `rating_move:${direction}`,
    direction,
    strength: round2(Math.abs(z)),
    cooldownDays: config.ratingRecentDays,
    detail: {
      windowDays: config.ratingRecentDays,
      recentCount: recent.length,
      recentMean: round2(recentMean),
      baselineCount: baseline.length,
      baselineMean: round2(baselineMean),
      deltaStars: round2(deltaStars),
    },
  }
}

// ---------------------------------------------------------------------------
// Detector 2: REVIEW VELOCITY
//
// Question: are reviews arriving at a rate this location's own history does not
// explain? A burst usually means something happened (a post landed, a bad night
// travelled); a drought usually means the ask stopped.
// ---------------------------------------------------------------------------

export function detectVelocityAnomaly(
  reviews: WatchdogReview[],
  nowMs: number,
  opts: { lastCapturedAtMs?: number | null; config?: WatchdogConfig } = {},
): ReviewAnomaly | null {
  const config = opts.config ?? REVIEW_WATCHDOG_CONFIG
  const recent = inWindow(reviews, nowMs, 0, config.velocityRecentDays)
  const baseline = inWindow(
    reviews,
    nowMs,
    config.velocityRecentDays,
    config.velocityRecentDays + config.velocityBaselineDays,
  )

  // GATE 1 (volume): enough history to call anything a rate.
  if (baseline.length < config.velocityMinBaseline) return null

  const ratePerDay = baseline.length / config.velocityBaselineDays
  const expected = ratePerDay * config.velocityRecentDays

  // GATE 1b: at a low enough arrival rate, no count in this window is
  // distinguishable from the usual quiet. Staying silent is the honest answer.
  if (expected < config.velocityMinExpected) return null

  const observed = recent.length
  const ratio = observed / expected

  // GATE 2 (effect): inside this band it is ordinary week-to-week variation.
  const low = 1 / config.velocityMinRatio
  if (ratio > low && ratio < config.velocityMinRatio) return null

  // GATE 3 (evidence).
  const z = anscombeZ(observed, expected)
  if (Math.abs(z) < config.velocityZ) return null

  const direction: AnomalyDirection = observed < expected ? "down" : "up"

  // GATE 4 (honesty): a DROUGHT is suppressed when our own capture has gone
  // stale, because a gap in collection is indistinguishable from customers going
  // quiet. A burst needs no such guard: we are holding the reviews that prove it.
  if (direction === "down") {
    const lastCapturedAtMs = opts.lastCapturedAtMs ?? null
    if (lastCapturedAtMs == null) return null
    if (nowMs - lastCapturedAtMs > config.captureStaleDays * DAY_MS) return null
  }

  return {
    kind: "review_velocity",
    key: `review_velocity:${direction}`,
    direction,
    strength: round2(Math.abs(z)),
    cooldownDays: config.velocityRecentDays,
    detail: {
      windowDays: config.velocityRecentDays,
      baselineDays: config.velocityBaselineDays,
      recentCount: observed,
      expectedCount: round2(expected),
      ratio: round2(ratio),
    },
  }
}

// ---------------------------------------------------------------------------
// Detector 3: RED-FLAG CLUSTER
//
// Question: are several recent reviews raising the SAME serious theme?
//
// REUSE, NOT REBUILD: the theme vocabulary is the red-flag category set the
// existing scoring pass already writes to location_reviews.red_flags (illness,
// food_safety, discrimination, safety, legal. See lib/reviews/scoring.ts, which
// floors severity on a verbatim phrase hit). This detector adds no extraction, no
// phrase list, and no model call; it counts categories that are already stored.
// ---------------------------------------------------------------------------

export function detectRedFlagClusters(
  reviews: WatchdogReview[],
  nowMs: number,
  config: WatchdogConfig = REVIEW_WATCHDOG_CONFIG,
): ReviewAnomaly[] {
  const recent = inWindow(reviews, nowMs, 0, config.clusterWindowDays)
  const baseline = inWindow(
    reviews,
    nowMs,
    config.clusterWindowDays,
    config.clusterWindowDays + config.clusterBaselineDays,
  )

  const countByCategory = (rows: WatchdogReview[]): Map<string, number> => {
    const out = new Map<string, number>()
    for (const row of rows) {
      // One review counts once per category even if it repeats one.
      for (const category of new Set(row.redFlags)) {
        out.set(category, (out.get(category) ?? 0) + 1)
      }
    }
    return out
  }

  const recentCounts = countByCategory(recent)
  const baselineCounts = countByCategory(baseline)
  const windowsInBaseline = config.clusterBaselineDays / config.clusterWindowDays

  const out: ReviewAnomaly[] = []
  for (const [category, recentCount] of recentCounts) {
    // GATE 1 + 2 (volume and effect, one number): below this it is a coincidence.
    if (recentCount < config.clusterMinCount) continue

    const baselineExpected = (baselineCounts.get(category) ?? 0) / windowsInBaseline

    // GATE 3 (evidence). When the category is effectively unheard of here
    // (expected under one per window), clusterMinCount reviews IS the finding and
    // no further test applies. When it is a recurring theme, the cluster has to
    // stand above this location's own normal level of it.
    const z = anscombeZ(recentCount, baselineExpected)
    if (baselineExpected >= 1 && z < config.clusterZ) continue

    out.push({
      kind: "red_flag_cluster",
      key: `red_flag_cluster:${category}`,
      // Always "up": more of a bad thing. There is no such thing as a
      // significant ABSENCE of red flags worth interrupting an operator for.
      direction: "up",
      strength: round2(Math.abs(z)),
      cooldownDays: config.clusterWindowDays,
      detail: {
        windowDays: config.clusterWindowDays,
        category,
        recentCount,
        baselineExpected: round2(baselineExpected),
      },
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The whole band, in one call.
// ---------------------------------------------------------------------------

export type WatchdogInput = {
  reviews: WatchdogReview[]
  nowMs: number
  /** Newest last_seen_at across the corpus, epoch ms. Null = capture state unknown. */
  lastCapturedAtMs?: number | null
  config?: WatchdogConfig
}

/** Every anomaly the data supports, strongest first. Deduping is a separate step. */
export function detectReviewAnomalies(input: WatchdogInput): ReviewAnomaly[] {
  const config = input.config ?? REVIEW_WATCHDOG_CONFIG
  const found: ReviewAnomaly[] = []

  const rating = detectRatingMove(input.reviews, input.nowMs, config)
  if (rating) found.push(rating)

  const velocity = detectVelocityAnomaly(input.reviews, input.nowMs, {
    lastCapturedAtMs: input.lastCapturedAtMs,
    config,
  })
  if (velocity) found.push(velocity)

  found.push(...detectRedFlagClusters(input.reviews, input.nowMs, config))

  // Red flags outrank everything else at equal strength: an illness cluster is a
  // different order of problem from a soft month. Otherwise, strongest first.
  const rank = (a: ReviewAnomaly) => (a.kind === "red_flag_cluster" ? 0 : 1)
  return found.sort((a, b) => rank(a) - rank(b) || b.strength - a.strength)
}

// ---------------------------------------------------------------------------
// ★ THE COOLDOWN ★
//
// ONE RULE: an anomaly's cooldown is its own observation window. A rating move is
// read over 30 days and stays quiet for 30; a velocity anomaly is read over 14 and
// stays quiet for 14. The consequence is the property we actually want: the
// watchdog can never report the same reviews twice. A finding that re-fires after
// its cooldown is, by construction, built on evidence it has never spoken about.
//
// DELIBERATE NON-GOAL: no "escalation" path that lets a worsening anomaly re-fire
// early. It reads reasonable and it is how watchdogs turn back into daily noise,
// since a slow slide keeps clearing any escalation delta. If the operator wants
// the current state they open /reviews, where the live finding is always shown.
// ---------------------------------------------------------------------------

/** A previously fired event, as stored in review_watch_events. */
export type WatchEventRecord = {
  anomalyKey: string
  cooldownUntilMs: number
}

export function cooldownUntilMs(anomaly: ReviewAnomaly, nowMs: number): number {
  return nowMs + anomaly.cooldownDays * DAY_MS
}

/**
 * Drop anomalies whose key is still inside a prior fire's cooldown. Pure, so the
 * "a persisting anomaly does not re-fire" property is a unit test, not a staging
 * observation. Suppression is keyed on `key` (kind plus direction or category), so
 * a rating RECOVERY is not silenced by an earlier rating DROP: that is new news.
 */
export function selectFiringAnomalies(
  anomalies: ReviewAnomaly[],
  priorEvents: WatchEventRecord[],
  nowMs: number,
): ReviewAnomaly[] {
  const suppressedUntil = new Map<string, number>()
  for (const event of priorEvents) {
    const known = suppressedUntil.get(event.anomalyKey)
    if (known == null || event.cooldownUntilMs > known) {
      suppressedUntil.set(event.anomalyKey, event.cooldownUntilMs)
    }
  }
  return anomalies.filter((a) => {
    const until = suppressedUntil.get(a.key)
    return until == null || nowMs >= until
  })
}
