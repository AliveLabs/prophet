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

/** Plays acted on in the trailing 7 days — the momentum strip's number. */
export async function loadWeeklyMomentum(locationId: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const { data } = await admin()
      .from("play_actions")
      .select("id")
      .eq("location_id", locationId)
      .gte("created_at", since)
    return (data ?? []).length
  } catch {
    return 0
  }
}
