// ---------------------------------------------------------------------------
// Persistence for the precomputed brief. The precompute job writes (service_role,
// bypasses RLS); the home reads. Keeps the render path LLM-free (just a DB read).
//
// Typed against a loose client surface because `daily_briefs` is not yet in the
// generated database.types.ts (it lands when the migration is applied + types are
// regenerated). The table is real post-migration; this keeps the code type-clean now.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { Brief } from "@/lib/skills/types"
import { updateInsightPool } from "@/lib/insights/insight-pool"

type QueryBuilder = {
  upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>
  select: (cols: string) => QueryBuilder
  eq: (col: string, val: string) => QueryBuilder
  order: (col: string, opts: { ascending: boolean }) => QueryBuilder
  limit: (n: number) => QueryBuilder
  maybeSingle: () => Promise<{ data: { brief?: unknown } | null }>
}
export type BriefStore = { from: (table: string) => QueryBuilder }

function store(client?: BriefStore): BriefStore {
  return client ?? (createAdminSupabaseClient() as unknown as BriefStore)
}

/** Upsert the synthesized brief for (location, date_key). */
export async function saveBrief(brief: Brief, opts: { fallback?: boolean; client?: BriefStore } = {}): Promise<void> {
  const { error } = await store(opts.client)
    .from("daily_briefs")
    .upsert(
      {
        location_id: brief.locationId,
        date_key: brief.dateKey,
        brief: brief as unknown as Record<string, unknown>,
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
