"use server"

// Server actions for the Brief home: per-play good/bad feedback and the
// brand-tolerance setting. Both write through the USER-scoped Supabase client so
// the org-member RLS policies (added in the daily_briefs migration) enforce access.
// `setBrandTolerance` now backs the Settings tuning control (explicit "Update my
// recommendations"), not the brief rail — the authed Settings page calls it.
//
// `brand_tolerance` / `brief_feedback` aren't in the generated DB types until types
// are regenerated, so we use the same loose-client cast the lib layer uses.

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { recordPlayFeedback, type Verdict } from "@/lib/skills/preferences"

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

type LocUpdater = {
  from: (t: string) => {
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
    }
  }
}
type FeedbackClient = Parameters<typeof recordPlayFeedback>[3] extends { client?: infer C } ? C : never

/** Record 👍/👎 on a play. Writes to brief_feedback (RLS: org members can insert). */
export async function submitPlayFeedback(input: {
  locationId: string
  dateKey: string
  playKey: string
  verdict: Verdict
  severity?: number
}): Promise<{ ok: boolean; error?: string }> {
  await requireUser()
  const supabase = await createServerSupabaseClient()
  try {
    await recordPlayFeedback(
      input.locationId,
      input.dateKey,
      { playKey: input.playKey, verdict: input.verdict, severity: input.severity ?? 0 },
      { client: supabase as unknown as FeedbackClient },
    )
    revalidatePath("/home")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "feedback failed" }
  }
}

// Save / Snooze / Dismiss (Batch 5) — latest action wins per (location, date, play);
// null clears (undo). User-scoped client: the play_actions RLS policies enforce
// membership. Fail-soft pre-migration.
type ActionStore = {
  from: (t: string) => {
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string }
    ) => Promise<{ error: { message: string } | null }>
    delete: () => {
      eq: (c: string, v: string) => {
        eq: (c2: string, v2: string) => {
          eq: (c3: string, v3: string) => Promise<{ error: { message: string } | null }>
        }
      }
    }
  }
}

export async function setPlayAction(input: {
  locationId: string
  dateKey: string
  playKey: string
  action: "saved" | "snoozed" | "dismissed" | null
}): Promise<{ ok: boolean; error?: string }> {
  await requireUser()
  const supabase = (await createServerSupabaseClient()) as unknown as ActionStore
  try {
    if (input.action === null) {
      const { error } = await supabase
        .from("play_actions")
        .delete()
        .eq("location_id", input.locationId)
        .eq("date_key", input.dateKey)
        .eq("play_key", input.playKey)
      if (error) return { ok: false, error: error.message }
    } else {
      const { error } = await supabase.from("play_actions").upsert(
        {
          location_id: input.locationId,
          date_key: input.dateKey,
          play_key: input.playKey,
          action: input.action,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "location_id,date_key,play_key" }
      )
      if (error) return { ok: false, error: error.message }
    }
    revalidatePath("/home")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "action failed" }
  }
}

/** Set the per-location recommendation breadth (0 focused/narrow .. 100 broad). */
export async function setBrandTolerance(
  locationId: string,
  value: number,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser()
  const supabase = await createServerSupabaseClient()
  const { error } = await (supabase as unknown as LocUpdater)
    .from("locations")
    .update({ brand_tolerance: clamp(value) })
    .eq("id", locationId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/home")
  return { ok: true }
}
