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
import { recordPlayFeedback, playKey, type Verdict } from "@/lib/skills/preferences"
import {
  recordDismissalCooldown,
  clearDismissalCooldown,
  saveEvergreenPlay,
  removeEvergreenPlay,
  type EvergreenStore,
  type EvergreenPlaysStore,
} from "@/lib/insights/evergreen"
import { getBrief } from "@/lib/insights/daily-brief"
import type { EnrichedRecommendation } from "@/lib/skills/types"

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

// Keep / Remove (2026-06-24 review; was Save/Snooze/Dismiss) — latest action wins per
// (location, date, play); null clears (undo). Keep persists as `saved` (positive signal +
// evergreen resurface); Remove persists as `dismissed` (visibility + cross-day cooldown, but
// NO learning weight — see feedback-signals). Snooze is retired. User-scoped client: the
// play_actions RLS policies enforce membership. Fail-soft pre-migration.
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
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c2: string, v2: string) => {
          eq: (c3: string, v3: string) => {
            maybeSingle: () => Promise<{ data: { action?: string } | null }>
          }
        }
      }
    }
  }
}

export async function setPlayAction(input: {
  locationId: string
  dateKey: string
  playKey: string
  // Keep → "saved", Remove → "dismissed", undo → null. (Snooze retired 2026-06-24.)
  action: "saved" | "dismissed" | null
  /** P7b: the full play, sent by the client on Keep ("saved") so persistence doesn't depend on the
   *  live brief still containing it (it may have been rebuilt since render). */
  play?: EnrichedRecommendation
}): Promise<{ ok: boolean; error?: string }> {
  await requireUser()
  const raw = await createServerSupabaseClient()
  const supabase = raw as unknown as ActionStore
  // Cooldown writes go through the USER-SCOPED client so RLS enforces org membership — a foreign
  // locationId can't touch another org's cooldowns (the admin client would bypass RLS).
  // Cooldown / evergreen writes go through the USER-SCOPED client so RLS enforces org membership.
  const evergreenClient = raw as unknown as EvergreenStore
  const evergreenPlaysClient = raw as unknown as EvergreenPlaysStore
  try {
    if (input.action === null) {
      // Read the prior action so undo reverses exactly what it undid (lift a dismissal cooldown OR
      // drop a persisted save) — and nothing else (e.g. undoing a save must not clear a cooldown).
      let priorAction: string | undefined
      try {
        const { data } = await supabase
          .from("play_actions")
          .select("action")
          .eq("location_id", input.locationId)
          .eq("date_key", input.dateKey)
          .eq("play_key", input.playKey)
          .maybeSingle()
        priorAction = data?.action
      } catch {
        /* best-effort: if we can't read the prior action, reverse nothing extra */
      }
      const { error } = await supabase
        .from("play_actions")
        .delete()
        .eq("location_id", input.locationId)
        .eq("date_key", input.dateKey)
        .eq("play_key", input.playKey)
      if (error) return { ok: false, error: error.message }
      if (priorAction === "dismissed") {
        try {
          await clearDismissalCooldown(input.locationId, input.playKey, { client: evergreenClient })
        } catch (e) {
          console.warn("[evergreen] clear cooldown failed:", e instanceof Error ? e.message : e)
        }
      } else if (priorAction === "saved") {
        try {
          await removeEvergreenPlay(input.locationId, input.playKey, { client: evergreenPlaysClient })
        } catch (e) {
          console.warn("[evergreen] remove saved play failed:", e instanceof Error ? e.message : e)
        }
      }
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
      // P7a: a dismissal sets a cross-day cooldown so the play doesn't regenerate into the next
      // brief for ~14 days (play_actions alone is per-date_key and wouldn't carry). Best-effort.
      if (input.action === "dismissed") {
        try {
          await recordDismissalCooldown(input.locationId, input.playKey, { client: evergreenClient })
        } catch (e) {
          console.warn("[evergreen] record cooldown failed:", e instanceof Error ? e.message : e)
        }
      } else if (input.action === "saved") {
        // P7b: persist the saved play for relevance-based resurfacing. Prefer the play the client sent
        // (robust even if today's brief was rebuilt since render); fall back to looking it up in the
        // current brief. SECURITY: the getBrief fallback uses the admin client (RLS bypass), so it MUST
        // stay after the user-scoped play_actions upsert above — that upsert's RLS with-check is what
        // gates membership for this location; reordering it would be an IDOR.
        try {
          const play =
            input.play ?? (await getBrief(input.locationId, { dateKey: input.dateKey }))?.plays.find((p) => playKey(p) === input.playKey)
          if (play) await saveEvergreenPlay(input.locationId, play, { client: evergreenPlaysClient })
        } catch (e) {
          console.warn("[evergreen] persist saved play failed:", e instanceof Error ? e.message : e)
        }
      }
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
