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
  opts: { client?: PoolStore; nowMs?: number; retentionDays?: number } = {},
): Promise<void> {
  if (plays.length === 0) return
  const now = opts.nowMs ?? Date.now()
  const retention = opts.retentionDays ?? POOL_RETENTION_DAYS
  const expiresAt = iso(now + retention * 86_400_000)
  const db = store(opts.client)

  // The LATEST brief's plays ARE the "top" (Bryan: ~5-7 new top insights/day push the rest out of
  // top). combinedScore is intentionally stripped from the served brief (presenter.ts — "play ORDER
  // encodes rank"), so we use the brief's PLAY ORDER as the rank signal: rank-1 gets the highest
  // combined_score. Older plays not in today's brief drop out of top but stay in the pool ("see all").
  const rows = plays.map((p, i) => ({
    location_id: locationId,
    play_key: playKey(p),
    play: p as unknown as Record<string, unknown>,
    first_seen_date: dateKey, // upsert replaces; last_seen_date is the canonical recency field
    last_seen_date: dateKey,
    combined_score: plays.length - i, // within-brief rank: rank-1 highest
    category: p.category ?? null,
    kind: p.kind ?? null,
    confidence: p.confidence ?? null,
    is_top: true,
    expires_at: expiresAt,
    updated_at: iso(now),
  }))

  // 1. Demote ALL of the location's current top entries first; then 2. upsert today's plays as the new
  //    top. Net result: exactly today's brief is is_top. (A brief build for a location is serialized,
  //    and only /home/pool reads is_top, so the sub-ms window where all are false is harmless.)
  const { error: resetErr } = await db
    .from("insight_pool_entries")
    .update({ is_top: false, updated_at: iso(now) })
    .eq("location_id", locationId)
  if (resetErr) throw new Error(`insight pool reset is_top failed: ${resetErr.message}`)

  const { error: upsertErr } = await db.from("insight_pool_entries").upsert(rows, { onConflict: "location_id,play_key" })
  if (upsertErr) throw new Error(`insight pool upsert failed: ${upsertErr.message}`)

  // 3. Retention sweep — drop entries unseen past expiry (opportunistic; keeps the table bounded).
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
    // "See all" order: this week's top first, then most-recent, then within-brief rank.
    entries = [...entries].sort(
      (a, b) =>
        Number(b.is_top) - Number(a.is_top) ||
        b.last_seen_date.localeCompare(a.last_seen_date) ||
        b.combined_score - a.combined_score,
    )
    return entries
  } catch {
    return []
  }
}
