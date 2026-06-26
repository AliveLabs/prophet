// ---------------------------------------------------------------------------
// Insight pool (#1/#2) — insights ACCUMULATE over time instead of being overwritten
// each run. Every brief save upserts its plays into insight_pool_entries; the top-N by
// score are flagged is_top (the "top" surface), the rest stay available via "see all",
// filterable by category. Entries unseen for POOL_RETENTION_DAYS expire.
//
// FAIL-SOFT: loadPoolEntries returns [] on any error (pre-migration safe). updateInsightPool
// throws on DB error; its sole caller (saveBrief) wraps it best-effort so a pool failure can
// never break a brief save. (Errors are surfaced — not swallowed — per the spine-upsert lesson.)
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { playKey } from "@/lib/skills/preferences"
import type { EnrichedRecommendation } from "@/lib/skills/types"

export const POOL_RETENTION_DAYS = 30
export const TOP_MAX = 7

export type PoolEntry = {
  id: string
  play_key: string
  play: EnrichedRecommendation
  first_seen_date: string
  last_seen_date: string
  combined_score: number
  category: string | null
  kind: string | null
  confidence: string | null
  is_top: boolean
  expires_at: string
}

type Res = { error: { message: string } | null }
type DataRes<T> = { data: T | null; error: { message: string } | null }

// Loose client surface — insight_pool_entries isn't in generated DB types until the migration is
// applied + types regenerated (same pattern as daily-brief.ts / evergreen.ts).
export type PoolStore = {
  from: (t: string) => {
    upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) => Promise<Res>
    update: (vals: Record<string, unknown>) => {
      eq: (c: string, v: string) => Promise<Res> & {
        eq: (c2: string, v2: string) => Promise<Res>
      }
    }
    delete: () => { lt: (c: string, v: string) => { eq: (c2: string, v2: string) => Promise<Res> } }
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, opts: { ascending: boolean }) => Promise<DataRes<Record<string, unknown>[]>>
      }
    }
  }
}

function store(client?: PoolStore): PoolStore {
  return client ?? (createAdminSupabaseClient() as unknown as PoolStore)
}

const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Upsert a brief's plays into the pool and recompute the top-N flag. Throws on DB error so the
 * caller can log it (saveBrief treats it best-effort). Idempotent per (location, play_key): a play
 * that re-appears refreshes its score/recency + extends its expiry; one that stops appearing expires.
 */
export async function updateInsightPool(
  locationId: string,
  plays: EnrichedRecommendation[],
  dateKey: string,
  opts: { client?: PoolStore; nowMs?: number; retentionDays?: number; topMax?: number } = {},
): Promise<void> {
  if (plays.length === 0) return
  const now = opts.nowMs ?? Date.now()
  const retention = opts.retentionDays ?? POOL_RETENTION_DAYS
  const topMax = opts.topMax ?? TOP_MAX
  const expiresAt = iso(now + retention * 86_400_000)
  const db = store(opts.client)

  // 1. Upsert today's plays. first_seen_date is passed but a conflicting row keeps its earlier
  //    value via GREATEST/LEAST? supabase-js upsert replaces the row, so first_seen tracks the most
  //    recent write — last_seen_date is the canonical recency field, so this is acceptable.
  const rows = plays.map((p) => ({
    location_id: locationId,
    play_key: playKey(p),
    play: p as unknown as Record<string, unknown>,
    first_seen_date: dateKey,
    last_seen_date: dateKey,
    combined_score: p.combinedScore ?? 0,
    category: p.category ?? null,
    kind: p.kind ?? null,
    confidence: p.confidence ?? null,
    is_top: false, // recomputed below
    expires_at: expiresAt,
    updated_at: iso(now),
  }))
  const { error: upsertErr } = await db.from("insight_pool_entries").upsert(rows, { onConflict: "location_id,play_key" })
  if (upsertErr) throw new Error(`insight pool upsert failed: ${upsertErr.message}`)

  // 2. Reload all live entries for the location, ranked, to find the current top-N keys.
  const { data, error: selErr } = await db
    .from("insight_pool_entries")
    .select("play_key, combined_score")
    .eq("location_id", locationId)
    .order("combined_score", { ascending: false })
  if (selErr) throw new Error(`insight pool select failed: ${selErr.message}`)
  const topKeys = (data ?? []).slice(0, topMax).map((r) => String(r.play_key))

  // 3. Reset is_top, then flip the top-N (bounded ≤ topMax round trips; topMax is small).
  const { error: resetErr } = await db.from("insight_pool_entries").update({ is_top: false }).eq("location_id", locationId)
  if (resetErr) throw new Error(`insight pool reset is_top failed: ${resetErr.message}`)
  for (const key of topKeys) {
    const { error: flipErr } = await db
      .from("insight_pool_entries")
      .update({ is_top: true, updated_at: iso(now) })
      .eq("location_id", locationId)
      .eq("play_key", key)
    if (flipErr) throw new Error(`insight pool flip is_top failed: ${flipErr.message}`)
  }

  // 4. Retention sweep — drop entries unseen past expiry (opportunistic; keeps the table bounded).
  await db.from("insight_pool_entries").delete().lt("expires_at", iso(now)).eq("location_id", locationId)
}

/** Load pool entries for a location (the "see all insights" view). FAIL-SOFT: [] on any error. */
export async function loadPoolEntries(
  locationId: string,
  opts: { client?: PoolStore; category?: string; topOnly?: boolean } = {},
): Promise<PoolEntry[]> {
  try {
    const db = store(opts.client)
    const { data, error } = await db
      .from("insight_pool_entries")
      .select("id, play_key, play, first_seen_date, last_seen_date, combined_score, category, kind, confidence, is_top, expires_at")
      .eq("location_id", locationId)
      .order("combined_score", { ascending: false })
    if (error) return []
    let entries = (data ?? []) as unknown as PoolEntry[]
    if (opts.topOnly) entries = entries.filter((e) => e.is_top)
    if (opts.category) entries = entries.filter((e) => e.category === opts.category)
    return entries
  } catch {
    return []
  }
}
