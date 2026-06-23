// ---------------------------------------------------------------------------
// Restaurant baseline + density loaders (Events Impact Engine · P2)
//
// The impact model's relative door divides expected incremental demand by the
// restaurant's OWN popular-times curve. Competitors' curves were already stored in
// busy_times, but the location's own curve was only fetched live in the dossier. We
// cache it in location_busy_times with a weekly refresh so the events pipeline reads
// it cheaply (no per-run Outscraper call). Density tier calibrates the surface bars.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchBusyTimes } from "@/lib/providers/outscraper"

const BASELINE_TTL_DAYS = 7

/** Curve indexed by day-of-week (0=Sun..6=Sat); each entry is hourly_scores[24] or null. */
export type BaselineCurveByDow = Array<number[] | null>

function rowsToCurve(rows: Array<{ day_of_week: number; hourly_scores: number[] }>): BaselineCurveByDow {
  const curve: BaselineCurveByDow = Array(7).fill(null)
  for (const r of rows) {
    if (r.day_of_week >= 0 && r.day_of_week <= 6 && Array.isArray(r.hourly_scores)) {
      curve[r.day_of_week] = r.hourly_scores
    }
  }
  return curve
}

/** Read the cached location curve. Returns an all-null curve if none stored yet
 *  (the impact model degrades gracefully — relative door simply off). */
export async function loadLocationBaseline(
  supabase: SupabaseClient,
  locationId: string,
): Promise<{ curveByDow: BaselineCurveByDow; freshestAt: string | null }> {
  const { data } = await supabase
    .from("location_busy_times")
    .select("day_of_week, hourly_scores, refreshed_at")
    .eq("location_id", locationId)
  const rows = data ?? []
  const freshestAt = rows.reduce<string | null>((acc, r) => {
    const t = r.refreshed_at as string | null
    return t && (!acc || t > acc) ? t : acc
  }, null)
  return { curveByDow: rowsToCurve(rows as Array<{ day_of_week: number; hourly_scores: number[] }>), freshestAt }
}

/** Read the cached curve; refresh it from Outscraper if missing/stale (>7d). The live
 *  fetch is gated to weekly so it never runs on the synchronous per-brief path more than
 *  once a week. Always fails soft to whatever is cached. */
export async function ensureLocationBaseline(
  supabase: SupabaseClient,
  locationId: string,
  primaryPlaceId: string | null,
  now: Date = new Date(),
): Promise<BaselineCurveByDow> {
  const { curveByDow, freshestAt } = await loadLocationBaseline(supabase, locationId)

  const hasData = curveByDow.some((c) => c != null)
  const stale =
    !freshestAt || now.getTime() - Date.parse(freshestAt) > BASELINE_TTL_DAYS * 86400_000

  if ((hasData && !stale) || !primaryPlaceId) return curveByDow

  try {
    const result = await fetchBusyTimes(primaryPlaceId, locationId)
    if (result && result.days.length > 0) {
      const rows = result.days.map((d) => ({
        location_id: locationId,
        day_of_week: d.day_of_week,
        hourly_scores: d.hourly_scores,
        peak_hour: d.peak_hour,
        peak_score: d.peak_score,
        slow_hours: d.slow_hours,
        current_popularity: result.current_popularity,
        refreshed_at: now.toISOString(),
      }))
      await supabase.from("location_busy_times").upsert(rows, { onConflict: "location_id,day_of_week" })
      return rowsToCurve(result.days)
    }
  } catch {
    /* fail soft to whatever we had cached */
  }
  return curveByDow
}
