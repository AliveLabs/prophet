"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { withAdminAction } from "@/lib/auth/with-admin-action"
import { logAdminAction } from "@/lib/admin/activity-log"
import {
  targetReviewStatusFor,
  isAllowedReviewTransition,
  parseFlagRef,
  type ReviewAction,
  type ReviewStatus,
  type FlagRef,
} from "@/lib/skills/source-quality-review"

type ActionResult = { ok: true; message: string } | { ok: false; error: string }

const REVIEW_ACTIONS: ReviewAction[] = ["resolve", "reopen"]

// reviewed_status/reviewed_by/reviewed_at aren't in the generated database.types.ts yet (see
// the migration's regen note) — same loose-surface posture as lib/skills/source-quality.ts and
// app/actions/knowledge-review.ts. A minimal filter-builder covers both tables' shapes: an
// insight is matched by `id`; a play_actions row by its natural key (location_id/date_key/play_key).
type Filters = Record<string, string>
type LooseAdminClient = {
  from: (table: string) => {
    select: (columns: string) => {
      match: (filters: Filters) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> }
    }
    update: (patch: Record<string, unknown>) => {
      match: (filters: Filters) => Promise<{ error: { message: string } | null }>
    }
  }
}

function filtersFor(ref: FlagRef): Filters {
  return ref.kind === "insight"
    ? { id: ref.id }
    : { location_id: ref.locationId, date_key: ref.dateKey, play_key: ref.playKey }
}

function tableFor(ref: FlagRef): "play_actions" | "insights" {
  return ref.kind === "brief_play" ? "play_actions" : "insights"
}

function normalizeStatus(value: unknown): ReviewStatus {
  return value === "resolved" ? "resolved" : "open"
}

/**
 * The mark-resolved/reopen mutation for a Source Quality triage flag (ALT-246). Writes ONLY
 * `reviewed_status` / `reviewed_by` / `reviewed_at` — never `action`/`reason` on play_actions or
 * `status` on insights (the columns lib/skills/feedback-rollup.ts reads for model learning). This
 * is a pure audit-trail flip: "a human looked at the source data behind this flag." It carries
 * zero weight toward the recommendation model.
 *
 * `ref` is a SourceQualityFlag.id from lib/skills/source-quality.ts (`brief:...` or `insight:...`),
 * parsed back into its natural key by the pure parseFlagRef() so the mutation targets the exact
 * row the UI is looking at without a surrogate id round-trip.
 */
export const reviewSourceQualityFlag = withAdminAction(
  "source_quality.manage",
  async (ctx, ref: string, action: ReviewAction): Promise<ActionResult> => {
    if (!REVIEW_ACTIONS.includes(action)) return { ok: false, error: `Unknown action: ${action}` }

    const flagRef = parseFlagRef(ref)
    if (!flagRef) return { ok: false, error: "Malformed flag reference." }

    const supabase = createAdminSupabaseClient() as unknown as LooseAdminClient
    const table = tableFor(flagRef)
    const filters = filtersFor(flagRef)

    const { data: row } = await supabase.from(table).select("reviewed_status").match(filters).maybeSingle()
    if (!row) return { ok: false, error: "That flag no longer exists." }
    const current = normalizeStatus(row.reviewed_status)

    if (!isAllowedReviewTransition(current, action)) {
      return { ok: false, error: `Already ${current}.` }
    }

    const target = targetReviewStatusFor(action)
    const patch = {
      reviewed_status: target,
      reviewed_by: target === "resolved" ? ctx.adminId : null,
      reviewed_at: target === "resolved" ? new Date().toISOString() : null,
    }

    const { error } = await supabase.from(table).update(patch).match(filters)
    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "source_quality.review",
      targetType: table,
      targetId: ref,
      details: { table, ref, transition: { from: current, to: target, action } },
    })

    revalidatePath("/admin/source-quality")
    return { ok: true, message: action === "resolve" ? "Marked resolved." : "Reopened." }
  },
)
