// ---------------------------------------------------------------------------
// Brand-tolerance preference + feedback loop (Bryan's control system).
//
// - Each customer has a `brandTolerance` slider (0-100). They can set it directly,
//   or it self-tunes from good/bad feedback: liking a wild (high-severity) play
//   raises tolerance; disliking one lowers it.
// - Feedback is captured per play (the UI wires the thumbs later). Stored to
//   brief_feedback; loaded to recalibrate.
//
// Loose client surface because brief_feedback isn't in the generated DB types until
// the migration is applied (same pattern as daily-brief.ts).
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { EnrichedRecommendation } from "@/lib/skills/types"

export type Verdict = "good" | "bad"
export type PlayFeedback = { playKey: string; verdict: Verdict; severity: number }

/** Stable key for a play (for feedback + dismissal targeting), independent of brief ordering.
 *  Prefers an explicit stableKey when present (FUSED plays — their model-written title is not
 *  deterministic across regenerations; P7a). Producer plays fall back to skillId:title-slug. */
export function playKey(p: Pick<EnrichedRecommendation, "skillId" | "title"> & { stableKey?: string }): string {
  if (p.stableKey) return p.stableKey
  const slug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
  return `${p.skillId}:${slug}`
}

const STEP = 8
const clamp = (n: number) => Math.max(0, Math.min(100, n))

/**
 * Recalibrate the tolerance from feedback. Severity is how adventurous the play was
 * (0 on-brand .. 3 wild). Liking a wild play raises tolerance; disliking one lowers it.
 * Feedback on tame plays barely moves the slider (it is not about tolerance).
 */
export function recalibrateTolerance(current: number, feedback: PlayFeedback[]): number {
  let t = current
  for (const f of feedback) {
    if (f.severity >= 2) {
      t += f.verdict === "good" ? STEP : -STEP
    } else if (f.severity === 1 && f.verdict === "bad") {
      t -= STEP / 2
    }
  }
  return clamp(Math.round(t))
}

// ── persistence (loose client; gated on the migration) ─────────────────────
type FeedbackStore = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: Array<Record<string, unknown>> | null }>
        }
      }
    }
  }
}

function store(client?: FeedbackStore): FeedbackStore {
  return client ?? (createAdminSupabaseClient() as unknown as FeedbackStore)
}

export async function recordPlayFeedback(
  locationId: string,
  dateKey: string,
  fb: PlayFeedback,
  opts: { client?: FeedbackStore } = {},
): Promise<void> {
  const { error } = await store(opts.client)
    .from("brief_feedback")
    .insert({ location_id: locationId, date_key: dateKey, play_key: fb.playKey, verdict: fb.verdict, severity: fb.severity })
  if (error) throw new Error(`recordPlayFeedback failed: ${error.message}`)
}

export async function loadFeedback(locationId: string, opts: { limit?: number; client?: FeedbackStore } = {}): Promise<PlayFeedback[]> {
  const { data } = await store(opts.client)
    .from("brief_feedback")
    .select("play_key, verdict, severity")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200)
  return (data ?? []).map((r) => ({
    playKey: String(r.play_key ?? ""),
    verdict: (r.verdict === "good" ? "good" : "bad") as Verdict,
    severity: typeof r.severity === "number" ? r.severity : 0,
  }))
}
