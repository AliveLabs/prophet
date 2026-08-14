// ---------------------------------------------------------------------------
// Review watchdog (beta rescue phase 4.2): persistence plus the nightly run.
//
// lib/reviews/watchdog.ts is the pure detection band; this file is the only part
// that touches the DB. Split so every threshold decision stays unit-testable with
// no database and no clock.
//
// FAIL-SOFT ON READ, LOUD ON WRITE. This is the same contract lib/reviews/store.ts sets:
// a read failure degrades to an empty surface (pre-migration safe), and a write
// failure is returned to the caller so it can be logged. A silent no-op in a
// fail-soft system is the worst failure mode.
//
// DEDUPE: the insert lands BEFORE anything is surfaced, and the primary key is
// (location_id, anomaly_key, fired_on), so a retried pipeline run inside the same
// day can never double-record. That is the trial_reminder_sends / weekly_digest_sends
// idiom. The multi-day half of the job (do not fire again while the SAME anomaly
// persists) is cooldown_until, enforced by selectFiringAnomalies before we get here.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  cooldownUntilMs,
  detectReviewAnomalies,
  selectFiringAnomalies,
  type ReviewAnomaly,
  type WatchEventRecord,
  type WatchdogConfig,
  type WatchdogReview,
} from "@/lib/reviews/watchdog"

// review_watch_events post-dates the generated Database types (migration
// 20260814093000, NOT yet applied), so this uses the same loose-client convention as
// location_reviews in lib/reviews/store.ts.
type Store = SupabaseClient

/** A persisted review_watch_events row. */
export type WatchEventRow = {
  location_id: string
  anomaly_key: string
  kind: string
  direction: string
  strength: number
  detail: Record<string, unknown>
  fired_on: string
  cooldown_until: string
  created_at: string
}

const DAY_MS = 86_400_000

/** History the detectors can see. Slightly wider than the widest window
 *  (ratingRecentDays + ratingBaselineDays = 395) so the baseline is never
 *  clipped by the query itself. */
const LOOKBACK_DAYS = 400

/** Hard cap on rows read per location. Real corpora run in the hundreds (the
 *  weekly backfill seeds 250), so this is a runaway guard, not a budget. */
const MAX_REVIEW_ROWS = 3000

/** UTC calendar date for a timestamp. Only used as a fallback: callers inside the
 *  pipeline pass the run's own dateKey. */
export function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Shape the raw rows the detectors read. Pure, exported for tests: rows with no
 *  parseable publish time are DROPPED rather than dated to "now", which would
 *  manufacture a burst out of a provider that stopped sending timestamps. */
export function toWatchdogReviews(
  rows: Array<{ rating?: unknown; published_at?: unknown; red_flags?: unknown }>,
): WatchdogReview[] {
  const out: WatchdogReview[] = []
  for (const row of rows) {
    const ms = typeof row.published_at === "string" ? Date.parse(row.published_at) : NaN
    if (!Number.isFinite(ms)) continue
    const rating = typeof row.rating === "number" && row.rating >= 1 && row.rating <= 5 ? row.rating : null
    const redFlags = Array.isArray(row.red_flags) ? row.red_flags.map(String) : []
    out.push({ rating, publishedAtMs: ms, redFlags })
  }
  return out
}

/** Newest last_seen_at across the rows, epoch ms, or null when none parse. This is
 *  the "are we still collecting?" evidence the drought suppressor needs. */
export function newestCaptureMs(rows: Array<{ last_seen_at?: unknown }>): number | null {
  let newest: number | null = null
  for (const row of rows) {
    const ms = typeof row.last_seen_at === "string" ? Date.parse(row.last_seen_at) : NaN
    if (Number.isFinite(ms) && (newest == null || ms > newest)) newest = ms
  }
  return newest
}

/** The location's review corpus, reduced to what the detectors read. FAIL-SOFT. */
export async function loadWatchdogCorpus(
  supabase: Store,
  locationId: string,
  opts: { nowMs?: number } = {},
): Promise<{ reviews: WatchdogReview[]; lastCapturedAtMs: number | null }> {
  const nowMs = opts.nowMs ?? Date.now()
  const since = new Date(nowMs - LOOKBACK_DAYS * DAY_MS).toISOString()
  // try/catch as well as the error check: a THROWN read (pre-migration, a denied
  // grant) must degrade to "we know nothing" exactly like a returned error would.
  // Silence is the only honest fallback for a watchdog. Same posture as loadPoolEntries.
  try {
    const { data, error } = await supabase
      .from("location_reviews")
      .select("rating, published_at, red_flags, last_seen_at")
      .eq("location_id", locationId)
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(MAX_REVIEW_ROWS)
    if (error) return { reviews: [], lastCapturedAtMs: null }
    const rows = (data ?? []) as Array<Record<string, unknown>>
    return { reviews: toWatchdogReviews(rows), lastCapturedAtMs: newestCaptureMs(rows) }
  } catch {
    return { reviews: [], lastCapturedAtMs: null }
  }
}

/**
 * Events still inside their cooldown. This ONE query serves both jobs: it is the
 * suppression set for the next run, and it is exactly what the operator surface
 * shows, because an anomaly's cooldown IS its observation window. FAIL-SOFT.
 */
export async function loadActiveWatchEvents(
  supabase: Store,
  locationId: string,
  opts: { nowMs?: number } = {},
): Promise<WatchEventRow[]> {
  const nowMs = opts.nowMs ?? Date.now()
  try {
    const { data, error } = await supabase
      .from("review_watch_events")
      .select("location_id, anomaly_key, kind, direction, strength, detail, fired_on, cooldown_until, created_at")
      .eq("location_id", locationId)
      .gt("cooldown_until", new Date(nowMs).toISOString())
      .order("fired_on", { ascending: false })
    if (error) return []
    return (data ?? []) as unknown as WatchEventRow[]
  } catch {
    return []
  }
}

/** Rows -> the pure cooldown records selectFiringAnomalies consumes. */
export function toWatchEventRecords(rows: WatchEventRow[]): WatchEventRecord[] {
  return rows
    .map((r) => ({ anomalyKey: r.anomaly_key, cooldownUntilMs: Date.parse(r.cooldown_until) }))
    .filter((r) => Number.isFinite(r.cooldownUntilMs))
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export type WatchWriteResult = { recorded: number; errors: string[] }

/** Record fired anomalies. A 23505 on the (location, key, day) primary key means
 *  another run in the same day already took it, which is the dedupe working, not
 *  an error. Everything else is surfaced. */
export async function recordWatchEvents(
  supabase: Store,
  locationId: string,
  anomalies: ReviewAnomaly[],
  opts: { nowMs?: number; firedOn?: string } = {},
): Promise<WatchWriteResult> {
  const nowMs = opts.nowMs ?? Date.now()
  const firedOn = opts.firedOn ?? utcDateKey(nowMs)
  const errors: string[] = []
  let recorded = 0
  for (const anomaly of anomalies) {
    const { error } = await supabase.from("review_watch_events").insert({
      location_id: locationId,
      anomaly_key: anomaly.key,
      kind: anomaly.kind,
      direction: anomaly.direction,
      strength: anomaly.strength,
      detail: anomaly.detail as unknown as Record<string, unknown>,
      fired_on: firedOn,
      cooldown_until: new Date(cooldownUntilMs(anomaly, nowMs)).toISOString(),
    })
    if (!error) {
      recorded += 1
    } else if (error.code !== "23505") {
      errors.push(`review_watch_events insert ${anomaly.key}: ${error.code ?? ""} ${error.message}`.trim())
    }
  }
  return { recorded, errors }
}

// ---------------------------------------------------------------------------
// The nightly run
// ---------------------------------------------------------------------------

export type WatchdogRunResult = {
  /** Anomalies the data supports right now, before cooldown filtering. */
  detected: number
  /** Anomalies actually recorded this run. */
  fired: ReviewAnomaly[]
  errors: string[]
}

/**
 * Detect, filter against active cooldowns, record. Called from the own-location
 * step of the insights pipeline, right after the review scoring pass, because
 * that is the moment the corpus is freshest.
 *
 * COSTS NO MODEL CALL. Two SELECTs and at most a handful of INSERTs.
 */
export async function runReviewWatchdog(
  supabase: Store,
  locationId: string,
  opts: { nowMs?: number; firedOn?: string; config?: WatchdogConfig } = {},
): Promise<WatchdogRunResult> {
  const nowMs = opts.nowMs ?? Date.now()
  const { reviews, lastCapturedAtMs } = await loadWatchdogCorpus(supabase, locationId, { nowMs })
  if (reviews.length === 0) return { detected: 0, fired: [], errors: [] }

  const detected = detectReviewAnomalies({ reviews, nowMs, lastCapturedAtMs, config: opts.config })
  if (detected.length === 0) return { detected: 0, fired: [], errors: [] }

  const active = await loadActiveWatchEvents(supabase, locationId, { nowMs })
  const firing = selectFiringAnomalies(detected, toWatchEventRecords(active), nowMs)
  if (firing.length === 0) return { detected: detected.length, fired: [], errors: [] }

  const write = await recordWatchEvents(supabase, locationId, firing, { nowMs, firedOn: opts.firedOn })
  return { detected: detected.length, fired: firing, errors: write.errors }
}
