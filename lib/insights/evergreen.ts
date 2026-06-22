// ---------------------------------------------------------------------------
// Evergreen (P7a) — cross-day dismissal cooldown.
//
// play_actions dismissals are keyed by (location_id, date_key, play_key), so dismissing a play today
// does NOT stop the same play from regenerating into tomorrow's brief. This records a durable cooldown:
// a dismissed playKey is suppressed from brief REBUILDS for `days` (default 14), then may resurface if
// still relevant. The brief-build path reads loadActiveCooldowns() and passes the keys to synthesize().
//
// FAIL-SOFT: every read returns empty and never throws (e.g. before the migration is applied), so the
// brief build can never break on this. Writes throw; callers (setPlayAction) treat them as best-effort.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { playKey } from "@/lib/skills/preferences"
import type { EnrichedRecommendation } from "@/lib/skills/types"

export const DEFAULT_COOLDOWN_DAYS = 14

// Loose client surface — evergreen_dismissals isn't in the generated DB types until the migration is
// applied + types regenerated (same pattern as daily-brief.ts / brief-actions.ts). Exported so a
// user-scoped client can be passed in (so RLS enforces membership on user-initiated writes).
export type EvergreenStore = {
  from: (t: string) => {
    upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>
    delete: () => {
      eq: (c: string, v: string) => { eq: (c2: string, v2: string) => Promise<{ error: { message: string } | null }> }
    }
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        gt: (c2: string, v2: string) => Promise<{ data: { play_key: string }[] | null; error: { message: string } | null }>
      }
    }
  }
}

function store(client?: EvergreenStore): EvergreenStore {
  return client ?? (createAdminSupabaseClient() as unknown as EvergreenStore)
}

const iso = (ms: number) => new Date(ms).toISOString()

/** Record (or refresh) a cross-day cooldown for a dismissed play. Throws on DB error (caller best-effort). */
export async function recordDismissalCooldown(
  locationId: string,
  playKey: string,
  opts: { days?: number; client?: EvergreenStore; nowMs?: number } = {},
): Promise<void> {
  const now = opts.nowMs ?? Date.now()
  const days = opts.days ?? DEFAULT_COOLDOWN_DAYS
  const { error } = await store(opts.client)
    .from("evergreen_dismissals")
    .upsert(
      {
        location_id: locationId,
        play_key: playKey,
        dismissed_at: iso(now),
        expires_at: iso(now + days * 86_400_000),
        updated_at: iso(now),
      },
      { onConflict: "location_id,play_key" },
    )
  if (error) throw new Error(`recordDismissalCooldown failed: ${error.message}`)
}

/** Clear a play's cooldown (e.g. the user undoes a dismissal). Throws on DB error (caller best-effort). */
export async function clearDismissalCooldown(
  locationId: string,
  playKey: string,
  opts: { client?: EvergreenStore } = {},
): Promise<void> {
  const { error } = await store(opts.client)
    .from("evergreen_dismissals")
    .delete()
    .eq("location_id", locationId)
    .eq("play_key", playKey)
  if (error) throw new Error(`clearDismissalCooldown failed: ${error.message}`)
}

/** The set of playKeys currently in cooldown for a location (expires_at in the future). FAIL-SOFT:
 *  returns an empty set on any error (incl. the table not existing pre-migration) so a brief build
 *  never breaks — the cooldown is simply inactive until the migration lands. */
export async function loadActiveCooldowns(
  locationId: string,
  opts: { client?: EvergreenStore; nowMs?: number } = {},
): Promise<Set<string>> {
  const now = opts.nowMs ?? Date.now()
  try {
    const { data, error } = await store(opts.client)
      .from("evergreen_dismissals")
      .select("play_key")
      .eq("location_id", locationId)
      .gt("expires_at", iso(now))
    if (error) return new Set()
    return new Set((data ?? []).map((r) => r.play_key))
  } catch {
    return new Set()
  }
}

// ── P7b: evergreen_plays — persisted "keep this" plays for relevance-based resurfacing ──────────

// Loose client surface for the evergreen_plays table (not in generated types yet).
export type EvergreenPlaysStore = {
  from: (t: string) => {
    upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>
    delete: () => {
      eq: (c: string, v: string) => { eq: (c2: string, v2: string) => Promise<{ error: { message: string } | null }> }
    }
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: { play: unknown }[] | null; error: { message: string } | null }>
        }
      }
    }
  }
}

/** Bound on how many persisted plays a single build loads as resurface candidates. */
const MAX_EVERGREEN_LOAD = 50

function playsStore(client?: EvergreenPlaysStore): EvergreenPlaysStore {
  return client ?? (createAdminSupabaseClient() as unknown as EvergreenPlaysStore)
}

/** Persist a SAVED play for later resurfacing. Throws on DB error (caller best-effort). */
export async function saveEvergreenPlay(
  locationId: string,
  play: EnrichedRecommendation,
  opts: { client?: EvergreenPlaysStore; nowMs?: number } = {},
): Promise<void> {
  const now = opts.nowMs ?? Date.now()
  const { error } = await playsStore(opts.client)
    .from("evergreen_plays")
    .upsert(
      {
        location_id: locationId,
        play_key: playKey(play),
        play: play as unknown as Record<string, unknown>,
        updated_at: iso(now),
      },
      { onConflict: "location_id,play_key" },
    )
  if (error) throw new Error(`saveEvergreenPlay failed: ${error.message}`)
}

/** Drop a persisted play (e.g. the user un-saves it). Throws on DB error (caller best-effort). */
export async function removeEvergreenPlay(
  locationId: string,
  playKeyStr: string,
  opts: { client?: EvergreenPlaysStore } = {},
): Promise<void> {
  const { error } = await playsStore(opts.client)
    .from("evergreen_plays")
    .delete()
    .eq("location_id", locationId)
    .eq("play_key", playKeyStr)
  if (error) throw new Error(`removeEvergreenPlay failed: ${error.message}`)
}

/** The persisted plays for a location (resurfacing candidates). FAIL-SOFT: returns [] on any error
 *  (incl. table-missing pre-migration) so a brief build never breaks. */
export async function loadEvergreenPlays(
  locationId: string,
  opts: { client?: EvergreenPlaysStore } = {},
): Promise<EnrichedRecommendation[]> {
  try {
    const { data, error } = await playsStore(opts.client)
      .from("evergreen_plays")
      .select("play")
      .eq("location_id", locationId)
      .order("saved_at", { ascending: false })
      .limit(MAX_EVERGREEN_LOAD)
    if (error) return []
    return (data ?? []).map((r) => r.play as EnrichedRecommendation).filter(Boolean)
  } catch {
    return []
  }
}
