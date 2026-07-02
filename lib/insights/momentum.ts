// The acted-on loop (complete-picture · Batch 5): per-play Save / Snooze / Dismiss
// state + weekly momentum. Loose-typed and fail-soft until the play_actions migration
// lands (ask_history pattern) — pre-migration the brief just renders with no actions.

import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type PlayAction = "saved" | "snoozed" | "dismissed"

// play_actions is now in the generated types, so the real typed client is used directly.
function admin() {
  return createAdminSupabaseClient()
}

/** playKey → action for one brief. Empty pre-migration. */
export async function loadPlayActions(
  locationId: string,
  dateKey: string
): Promise<Record<string, PlayAction>> {
  try {
    const { data } = await admin()
      .from("play_actions")
      .select("play_key, action")
      .eq("location_id", locationId)
      .eq("date_key", dateKey)
    const map: Record<string, PlayAction> = {}
    for (const r of data ?? []) map[String(r.play_key)] = r.action as PlayAction
    return map
  } catch {
    return {}
  }
}

/** playKey → its LATEST action across ALL briefs (rows are date-ordered so the newest date_key
 *  wins). The pool's cross-date read (ALT-184g): `saved` rows drive the Pinned section, and the
 *  returned date_key is the row the pool's Keep/Dismiss/undo writes key against — the same
 *  (location, date, play) contract the brief uses. Empty pre-migration / on any error. */
export async function loadLatestPlayActionsByKey(
  locationId: string
): Promise<Record<string, { action: PlayAction; dateKey: string }>> {
  try {
    const { data } = await admin()
      .from("play_actions")
      .select("play_key, action, date_key")
      .eq("location_id", locationId)
      .order("date_key", { ascending: true })
    const map: Record<string, { action: PlayAction; dateKey: string }> = {}
    for (const r of data ?? []) {
      map[String(r.play_key)] = { action: r.action as PlayAction, dateKey: String(r.date_key) }
    }
    return map
  } catch {
    return {}
  }
}

/** Plays the operator is ON in the trailing 7 days — the "Acted this week" strip's number.
 *  ONLY counts Kept plays (action = "saved"): the widget says "plays you kept or acted on",
 *  so a Removed (dismissed) play — the opposite of acting — must NOT inflate it. Each play has at
 *  most one row per (location, date, play) (the upsert key), so distinct rows = distinct kept plays;
 *  no double-counting, and clicks/thumbs live in brief_feedback (not play_actions) so they don't count. */
export async function loadWeeklyMomentum(locationId: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const { data } = await admin()
      .from("play_actions")
      .select("id")
      .eq("location_id", locationId)
      .eq("action", "saved")
      .gte("created_at", since)
    return (data ?? []).length
  } catch {
    return 0
  }
}
