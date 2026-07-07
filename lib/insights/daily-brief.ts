// ---------------------------------------------------------------------------
// Persistence for the precomputed brief. The precompute job writes (service_role,
// bypasses RLS); the home reads. Keeps the render path LLM-free (just a DB read).
//
// Typed against a loose client surface because `daily_briefs` is not yet in the
// generated database.types.ts (it lands when the migration is applied + types are
// regenerated). The table is real post-migration; this keeps the code type-clean now.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Brief } from "@/lib/skills/types"
import type { Database, Json } from "@/types/database.types"
import { updateInsightPool } from "@/lib/insights/insight-pool"
import { extractPreviousBuild, type PreviousBuild } from "@/lib/skills/differential"
import { isWeeklyFullBuildDay } from "@/lib/jobs/build-schedule"

// Was a hand-written loose surface; daily_briefs is now in the generated types, so this is just the
// real typed client. Aliased so callers can still inject a (mock) client in tests.
export type BriefStore = SupabaseClient<Database>

function store(client?: BriefStore): BriefStore {
  return client ?? createAdminSupabaseClient()
}

/** Upsert the synthesized brief for (location, date_key). */
export async function saveBrief(brief: Brief, opts: { fallback?: boolean; client?: BriefStore } = {}): Promise<void> {
  const { error } = await store(opts.client)
    .from("daily_briefs")
    .upsert(
      {
        location_id: brief.locationId,
        date_key: brief.dateKey,
        brief: brief as unknown as Json,
        fallback: opts.fallback ?? !!brief.fallback,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "location_id,date_key" },
    )
  if (error) throw new Error(`saveBrief failed: ${error.message}`)

  // Accumulate this brief's plays into the durable insight pool (#1/#2). Best-effort: a pool
  // failure (or a not-yet-applied migration) must NEVER break a brief save. Skips for fallback briefs.
  if (!(opts.fallback ?? !!brief.fallback) && brief.plays.length > 0) {
    try {
      await updateInsightPool(brief.locationId, brief.plays, brief.dateKey)
    } catch (err) {
      console.warn(`[saveBrief] insight pool update failed for ${brief.locationId}:`, err)
    }
  }
}

/** Does the location have ANY brief yet? Drives the one-time first-brief email. */
export async function hasAnyBrief(locationId: string, opts: { client?: BriefStore } = {}): Promise<boolean> {
  const { data } = await store(opts.client)
    .from("daily_briefs")
    .select("date_key")
    .eq("location_id", locationId)
    .order("date_key", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data != null
}

/** Read the precomputed brief for a location (a specific date, else the latest). */
export async function getBrief(locationId: string, opts: { dateKey?: string; client?: BriefStore } = {}): Promise<Brief | null> {
  let q = store(opts.client).from("daily_briefs").select("brief, date_key").eq("location_id", locationId)
  if (opts.dateKey) q = q.eq("date_key", opts.dateKey)
  const { data } = await q.order("date_key", { ascending: false }).limit(1).maybeSingle()
  return (data?.brief as Brief | undefined) ?? null
}

/** Differential builds: load yesterday's reusable per-skill state, applying every gate in ONE place.
 *  Returns undefined (→ full build) when: env DIFFERENTIAL_BUILDS=0, forced full build, the weekly
 *  Sunday-local full-build day, no/too-old previous brief, or any error (always fail-soft). */
export async function loadPreviousBuild(
  locationId: string,
  todayKey: string,
  opts: { force?: boolean; client?: BriefStore } = {},
): Promise<PreviousBuild | undefined> {
  try {
    if (opts.force || process.env.DIFFERENTIAL_BUILDS === "0") return undefined
    const sb = store(opts.client)
    const { data: loc } = await sb.from("locations").select("timezone").eq("id", locationId).maybeSingle()
    if (isWeeklyFullBuildDay(loc?.timezone, new Date())) {
      console.log(`[loadPreviousBuild] ${locationId}: weekly full-build day (Sunday local) — no reuse`)
      return undefined
    }
    const prev = await getBrief(locationId, { client: sb })
    return extractPreviousBuild(prev, todayKey)
  } catch (err) {
    console.warn(`[loadPreviousBuild] ${locationId}: failed (full build):`, err)
    return undefined
  }
}
