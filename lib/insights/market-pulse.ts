// ---------------------------------------------------------------------------
// Market-pulse loader (beta rescue Phase 3.2).
//
// The DB half of the two /home additions: the competitor changelog and the market benchmark.
// Everything it reads was already paid for by the nightly pipelines, and it makes NO model
// call and NO vendor call. The decisions all live in the pure modules it imports
// (`market-changes.ts`, `market-benchmark.ts`); this file only fetches and hands over.
//
// Fail-soft, same contract as `lib/insights/momentum.ts`: any error yields an empty pulse and
// the section self-hides. A /home that renders without this beats a /home that does not render.
//
// ACCESS IS THE CALLER'S JOB — this runs on the admin client and trusts the locationId it is
// given. /home resolves that id from the signed-in user's current organization before calling.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  buildCompetitorChangelog,
  changelogWindowStart,
  type ChangelogEntry,
  type ChangeRow,
  type TrackedCompetitor,
} from "./market-changes"
import {
  buildMarketBenchmark,
  resolveStoredRating,
  type MarketBenchmark,
  type RatedEntity,
} from "./market-benchmark"

export type MarketPulse = {
  changes: ChangelogEntry[]
  benchmark: MarketBenchmark | null
}

/** Where the operator's own stored rating lives: written by the insights pipeline's own-listing
 *  diff step (`lib/jobs/pipelines/insights.ts`), free-text provider key, no migration. */
const OWN_PROFILE_PROVIDER = "google_places_profile"

/** ALT-750: `listing_daily` IS NEVER WRITTEN. Verified against prod 2026-08-21: `snapshots` holds
 *  six types (five `seo_*_weekly` plus `web_menu_weekly`), none of them this one, and ZERO rows
 *  carry a `profile` key at all. So this read has always returned nothing and the competitor
 *  rating shown to operators comes from the NEXT link in market-benchmark's chain,
 *  `[snapshotProfile, placeDetails, metadata]`.
 *
 *  The read is left in place rather than deleted, because deleting it would remove the only marker
 *  of where a FRESH competitor listing was supposed to come from, and the staleness below is a real
 *  open problem rather than a tidy-up. It costs one indexed query that matches no rows.
 *
 *  ⚠️ THE ACTUAL PROBLEM, and it needs a spend decision rather than a code change:
 *  `competitors.metadata.rating` is written once at DISCOVERY and never refreshed. Verified in prod:
 *  of 50 competitors, ZERO have `updated_at` more than a day past `created_at`, and the oldest was
 *  added 2026-06-09. So every competitor rating an operator sees is frozen at the moment we found
 *  them, by up to 73 days, on a product whose whole promise is knowing what rivals are doing now.
 *
 *  Refreshing means a paid Places call per competitor per period (50 competitors today), so the
 *  cadence is Bryan's call, not something to pick here. Tracked on ALT-750. */
const LISTING_SNAPSHOT_TYPE = "listing_daily"

/** Bounded read: seven days of one location's rows is small, and the cap stops a pathological
 *  location from pulling an unbounded page into a server render. */
const CHANGE_ROW_LIMIT = 300

/** Ceiling on the listing-snapshot read. Date-desc, so the newest row for each of a handful of
 *  competitors lands well inside this. */
const SNAPSHOT_ROW_LIMIT = 500

function displayName(label: unknown, name: unknown): string {
  const l = typeof label === "string" ? label.trim() : ""
  if (l) return l
  const n = typeof name === "string" ? name.trim() : ""
  return n || "Competitor"
}

/**
 * The changelog and the benchmark for one location, both already gated.
 *
 * `changes` is empty when nothing real changed this week; `benchmark` is null when the data
 * cannot support an honest comparison. The surface renders neither in those cases.
 */
export async function loadMarketPulse(locationId: string, now: Date = new Date()): Promise<MarketPulse> {
  try {
    const supabase = createAdminSupabaseClient()

    const { data: compRows } = await supabase
      .from("competitors")
      .select("id, name, display_label, metadata")
      .eq("location_id", locationId)
      .eq("is_active", true)

    // Approved competitors only: the tracked set is what the operator confirmed, not every
    // candidate discovery turned up.
    const approved = (compRows ?? []).filter(
      (c) => (c.metadata as Record<string, unknown> | null)?.status === "approved",
    )
    // The canonical `name` rides along as a match alias: the social / SERP / menu rules write
    // THAT name into `evidence`, so a competitor the operator relabelled would otherwise stop
    // matching its own rows. Display still uses the operator's label.
    const competitors: TrackedCompetitor[] = approved.map((c) => ({
      id: c.id,
      name: displayName(c.display_label, c.name),
      aliases: typeof c.name === "string" && c.name.trim() ? [c.name] : [],
    }))
    const competitorIds = competitors.map((c) => c.id)

    const since = changelogWindowStart(now)

    const [{ data: insightRows }, { data: snapshotRows }, { data: ownRow }] = await Promise.all([
      supabase
        .from("insights")
        .select("id, insight_type, competitor_id, date_key, created_at, evidence")
        .eq("location_id", locationId)
        .gte("date_key", since)
        .neq("status", "dismissed")
        .order("date_key", { ascending: false })
        .limit(CHANGE_ROW_LIMIT),
      competitorIds.length
        ? supabase
            .from("snapshots")
            .select("competitor_id, raw_data, date_key")
            .in("competitor_id", competitorIds)
            .eq("snapshot_type", LISTING_SNAPSHOT_TYPE)
            .order("date_key", { ascending: false })
            // Only the newest row per competitor is used, and rows arrive date-desc, so this
            // is a render guard rather than a correctness bound.
            .limit(SNAPSHOT_ROW_LIMIT)
        : Promise.resolve({ data: [] as Array<{ competitor_id: string; raw_data: unknown; date_key: string }> }),
      supabase
        .from("location_snapshots")
        .select("raw_data")
        .eq("location_id", locationId)
        .eq("provider", OWN_PROFILE_PROVIDER)
        .order("date_key", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const rows: ChangeRow[] = (insightRows ?? []).map((r) => ({
      id: r.id,
      competitorId: r.competitor_id,
      insightType: r.insight_type,
      dateKey: r.date_key,
      createdAt: r.created_at,
      evidence: r.evidence,
    }))
    const changes = buildCompetitorChangelog(rows, competitors)

    // Newest listing snapshot per competitor (rows arrive date-desc, so the first wins).
    const profileByComp = new Map<string, unknown>()
    for (const row of snapshotRows ?? []) {
      const id = row.competitor_id as string
      if (profileByComp.has(id)) continue
      profileByComp.set(id, (row.raw_data as { profile?: unknown } | null)?.profile ?? null)
    }

    const rated: RatedEntity[] = approved.map((c) => {
      const meta = (c.metadata as Record<string, unknown> | null) ?? null
      return resolveStoredRating({
        snapshotProfile: profileByComp.get(c.id) ?? null,
        placeDetails: (meta?.placeDetails as Record<string, unknown> | null) ?? null,
        metadata: meta,
      })
    })

    const own = resolveStoredRating({
      snapshotProfile: (ownRow?.raw_data as { profile?: unknown } | null)?.profile ?? null,
    })
    const benchmark = buildMarketBenchmark(own, rated)

    return { changes, benchmark }
  } catch {
    return { changes: [], benchmark: null }
  }
}
