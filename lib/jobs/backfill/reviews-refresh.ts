// Automated Outscraper review backfill (Review Intelligence follow-up).
//
// Google Places Details caps at 5 "most relevant" reviews per fetch, so the daily
// capture corpus grows slowly and never reaches BACKWARD into a location's real
// history. This reaches back via lib/providers/outscraper#fetchLocationReviews on a
// weekly cadence: a one-time deep SEED per location, then small newest-N TOP-UPs.
//
// Bounded per run + idempotent (mirrors lib/jobs/backfill/focal-refresh): the
// Monday schedule can fire a few times and drain via the `done` flag, and a marker
// snapshot per location stops the same location being re-pulled the same week.
//
// NO schema change: seed/last-pull state lives in a location_snapshots marker row
// (provider = REVIEW_BACKFILL_MARKER), the same infra the insights pipeline already
// upserts to (plain (location_id, provider, date_key) unique key, free-text provider).
//
// Dedup is exact (upsertLocationReviews upserts on (location_id, source,
// source_review_id)), so overlapping pulls never split rows; existing scores/triage
// survive. New rows land unscored and the normal scoring pass picks them up.

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchLocationReviews } from "@/lib/providers/outscraper"
import { upsertLocationReviews } from "@/lib/reviews/store"

// location_reviews / this marker post-date the generated Database types — same
// loose-client convention as lib/reviews/store.ts.
type Admin = SupabaseClient

export const REVIEW_BACKFILL_MARKER = "outscraper_reviews"
const SEED_LIMIT = 250
const TOPUP_LIMIT = 50
const TOPUP_INTERVAL_DAYS = 7

export type BackfillCandidate = { locationId: string; placeId: string; mode: "seed" | "topup" }

/** UTC date arithmetic on a YYYY-MM-DD string (date_key is a DATE column). */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Pure selection: which locations owe a pull this run. Never-seeded locations
 *  come FIRST (mode "seed"), then locations whose last pull is older than the
 *  interval (mode "topup"), oldest-pulled first. `lastPullByLocation` maps
 *  location id -> latest marker date_key (YYYY-MM-DD); a missing entry means never
 *  seeded. YYYY-MM-DD strings compare correctly with `<`. Exported for tests. */
export function selectReviewBackfillCandidates(
  locations: Array<{ id: string; primary_place_id: string | null }>,
  lastPullByLocation: Map<string, string>,
  opts: { today: string; intervalDays?: number; max: number },
): BackfillCandidate[] {
  const intervalDays = opts.intervalDays ?? TOPUP_INTERVAL_DAYS
  const dueBefore = addDays(opts.today, -intervalDays)
  const seeds: BackfillCandidate[] = []
  const topups: Array<BackfillCandidate & { last: string }> = []
  for (const loc of locations) {
    if (!loc.primary_place_id) continue
    const last = lastPullByLocation.get(loc.id)
    if (!last) {
      seeds.push({ locationId: loc.id, placeId: loc.primary_place_id, mode: "seed" })
    } else if (last < dueBefore) {
      topups.push({ locationId: loc.id, placeId: loc.primary_place_id, mode: "topup", last })
    }
  }
  topups.sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : 0))
  const ordered: BackfillCandidate[] = [
    ...seeds,
    ...topups.map((t) => ({ locationId: t.locationId, placeId: t.placeId, mode: t.mode })),
  ]
  return ordered.slice(0, Math.max(0, opts.max))
}

export type ReviewBackfillRunResult = {
  processed: Array<{
    locationId: string
    mode: "seed" | "topup"
    fetched: number
    written: number
    totalReviews: number | null
    errors: string[]
  }>
  /** Locations still owed a pull after this run (unattempted + any that failed). */
  remaining: number
  done: boolean
}

/** One bounded run of the backfill. Reads candidates, pulls + upserts up to `max`
 *  locations, and marks each SUCCESSFUL pull so it isn't re-pulled until the
 *  interval elapses. A failed pull is left unmarked so a later run retries it
 *  (that's why `remaining`/`done` are computed from SUCCESSES, not the batch size). */
export async function refreshLocationReviews(
  admin: Admin,
  opts: { max?: number; seedLimit?: number; topupLimit?: number; today?: string } = {},
): Promise<ReviewBackfillRunResult> {
  const max = Math.min(25, Math.max(1, opts.max ?? 5))
  const seedLimit = opts.seedLimit ?? SEED_LIMIT
  const topupLimit = opts.topupLimit ?? TOPUP_LIMIT
  const today = opts.today ?? new Date().toISOString().slice(0, 10)

  const { data: locs, error: locErr } = await admin
    .from("locations")
    .select("id, primary_place_id")
    .not("primary_place_id", "is", null)
  if (locErr) throw new Error(`locations read: ${locErr.code ?? ""} ${locErr.message}`.trim())
  const locations = (locs ?? []) as Array<{ id: string; primary_place_id: string | null }>

  const { data: markers, error: mErr } = await admin
    .from("location_snapshots")
    .select("location_id, date_key")
    .eq("provider", REVIEW_BACKFILL_MARKER)
  if (mErr) throw new Error(`marker read: ${mErr.code ?? ""} ${mErr.message}`.trim())
  const lastPull = new Map<string, string>()
  for (const m of (markers ?? []) as Array<{ location_id: string; date_key: string }>) {
    const prev = lastPull.get(m.location_id)
    if (!prev || m.date_key > prev) lastPull.set(m.location_id, m.date_key)
  }

  const allDue = selectReviewBackfillCandidates(locations, lastPull, {
    today,
    max: Number.MAX_SAFE_INTEGER,
  })
  const batch = allDue.slice(0, max)

  const processed: ReviewBackfillRunResult["processed"] = []
  let succeeded = 0
  for (const cand of batch) {
    const limit = cand.mode === "seed" ? seedLimit : topupLimit
    const errors: string[] = []
    let fetched = 0
    let written = 0
    let totalReviews: number | null = null
    let ok = false
    try {
      const pull = await fetchLocationReviews(cand.placeId, { limit, sort: "newest" })
      fetched = pull.captured.length
      totalReviews = pull.totalReviews
      if (pull.captured.length > 0) {
        const res = await upsertLocationReviews(admin, cand.locationId, pull.captured)
        written = res.written
        errors.push(...res.errors)
      }
      // Marker records the pull so this location isn't re-selected until the
      // interval elapses. Only a written marker "finishes" a location.
      const { error: markErr } = await admin.from("location_snapshots").upsert(
        {
          location_id: cand.locationId,
          provider: REVIEW_BACKFILL_MARKER,
          date_key: today,
          captured_at: new Date().toISOString(),
          raw_data: { mode: cand.mode, fetched, written, totalReviews, name: pull.name },
        },
        { onConflict: "location_id,provider,date_key" },
      )
      if (markErr) errors.push(`marker upsert: ${markErr.code ?? ""} ${markErr.message}`.trim())
      else ok = true
    } catch (e) {
      errors.push(`${cand.mode} pull failed: ${(e as Error).message}`)
    }
    if (ok) succeeded += 1
    processed.push({ locationId: cand.locationId, mode: cand.mode, fetched, written, totalReviews, errors })
  }

  const remaining = Math.max(0, allDue.length - succeeded)
  return { processed, remaining, done: remaining === 0 }
}
