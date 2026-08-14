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
import type { SupabaseClient } from "@supabase/supabase-js"
import { playKey } from "@/lib/skills/preferences"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { Database, Json } from "@/types/database.types"

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

// insight_pool_entries is now in the generated types, so this is the real typed client. Aliased so
// callers can still inject a (mock) client in tests.
export type PoolStore = SupabaseClient<Database>

function store(client?: PoolStore): PoolStore {
  return client ?? createAdminSupabaseClient()
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
    play: p as unknown as Json,
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
  const { error: sweepErr } = await db.from("insight_pool_entries").delete().lt("expires_at", iso(now)).eq("location_id", locationId)
  if (sweepErr) console.warn(`[insight-pool] retention sweep failed: ${sweepErr.message}`)
}

/** What the LATEST brief contained, by category — the honest feedback the settings
 *  sliders show beside each category (ALT-554). `dateKey` names the brief the counts
 *  came from, and is null when there is nothing to count (no brief built yet, or the
 *  read failed), which is the caller's signal to render no counts at all rather than a
 *  column of zeroes that reads as "these sliders do nothing". */
export type LatestBriefCategoryCounts = {
  dateKey: string | null
  counts: Record<string, number>
}

/** Pure half of the above, so the counting rule is unit-testable without a DB.
 *  Scoped to `is_top` on purpose: those rows ARE the latest brief's plays (updateInsightPool
 *  clears the flag fleet-wide for the location, then re-stamps today's). A wider window (the
 *  full 30-day pool) would count plays the current sliders never ranked, which is the one
 *  thing that would make this number lie. Uncategorised plays are counted by nobody: they
 *  have no slider to sit beside. */
export function latestBriefCategoryCounts(
  rows: Array<{ category: string | null; last_seen_date: string | null }>,
): LatestBriefCategoryCounts {
  const counts: Record<string, number> = {}
  let dateKey: string | null = null
  for (const row of rows) {
    if (row.last_seen_date && (dateKey === null || row.last_seen_date > dateKey)) dateKey = row.last_seen_date
    if (!row.category) continue
    counts[row.category] = (counts[row.category] ?? 0) + 1
  }
  return { dateKey, counts }
}

/** Load the latest brief's per-category play counts. FAIL-SOFT, same posture as
 *  loadPoolEntries: a settings page must render even pre-migration or on a read error. */
export async function loadLatestBriefCategoryCounts(
  locationId: string,
  opts: { client?: PoolStore } = {},
): Promise<LatestBriefCategoryCounts> {
  const empty: LatestBriefCategoryCounts = { dateKey: null, counts: {} }
  try {
    const db = store(opts.client)
    const { data, error } = await db
      .from("insight_pool_entries")
      .select("category, last_seen_date")
      .eq("location_id", locationId)
      .eq("is_top", true)
    if (error) return empty
    return latestBriefCategoryCounts((data ?? []) as Array<{ category: string | null; last_seen_date: string | null }>)
  } catch {
    return empty
  }
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
