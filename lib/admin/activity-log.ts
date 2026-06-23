import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { Json } from "@/types/database.types"

// Sentinel actor id for non-admin (system) writers, e.g. the Stripe webhook. The column is
// NOT NULL UUID with no FK, so a fixed zero-UUID is a safe "no human actor" marker.
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000"

interface LogActionParams {
  adminId: string
  adminEmail: string
  action: string
  targetType: string
  targetId: string
  details?: Record<string, unknown>
  /** Operator justification. Required by logCriticalAction; optional for best-effort logs. */
  reason?: string
  /** 'admin' (a platform admin) or 'system' (an automated writer). Defaults to 'admin'. */
  actorType?: "admin" | "system"
  /** Pre-mutation snapshot for destructive actions (stored under details.before). */
  before?: unknown
  /** Post-mutation snapshot (stored under details.after). */
  after?: unknown
}

function buildRow(p: LogActionParams) {
  const details: Record<string, unknown> = { ...(p.details ?? {}) }
  if (p.before !== undefined) details.before = p.before
  if (p.after !== undefined) details.after = p.after
  return {
    admin_user_id: p.adminId,
    admin_email: p.adminEmail,
    action: p.action,
    target_type: p.targetType,
    target_id: p.targetId,
    reason: p.reason ?? null,
    actor_type: p.actorType ?? "admin",
    details: details as Json,
  }
}

/**
 * Best-effort audit log for NON-destructive actions. Never blocks the action; on failure it
 * warns and moves on. (The table is append-only at the DB level as of Phase 6b, so what lands
 * can never be altered or erased.)
 */
export async function logAdminAction(params: LogActionParams): Promise<void> {
  const supabase = createAdminSupabaseClient()
  const { error } = await supabase.from("admin_activity_log").insert(buildRow(params))
  if (error) {
    console.error("Failed to log admin action:", error.message)
  }
}

/**
 * Strict audit log for DESTRUCTIVE actions — enforces "no log ⇒ no action". Call this BEFORE
 * the destructive write and ABORT the action if it returns { ok:false }: an operation we
 * cannot record must not happen. A non-empty `reason` is mandatory.
 *
 * Returns a result (rather than throwing) so callers handle it explicitly with their own
 * { ok:false, error } shape — no reliance on exception flow through the action wrapper.
 */
export async function logCriticalAction(
  params: LogActionParams
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!params.reason || !params.reason.trim()) {
    return { ok: false, error: "A reason is required for this action." }
  }
  const supabase = createAdminSupabaseClient()
  const { error } = await supabase
    .from("admin_activity_log")
    .insert(buildRow({ ...params, reason: params.reason.trim() }))
  if (error) {
    return {
      ok: false,
      error: `Could not record this action in the audit log, so it was not performed. (${error.message})`,
    }
  }
  return { ok: true }
}
