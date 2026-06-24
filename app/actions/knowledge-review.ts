"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { withAdminAction } from "@/lib/auth/with-admin-action"
import { logAdminAction } from "@/lib/admin/activity-log"
import {
  isAllowedTransition,
  targetStatusFor,
  type KnowledgeAction,
  type KnowledgeStatus,
} from "@/lib/skills/knowledge-admin"

type ActionResult = { ok: true; message: string } | { ok: false; error: string }

const KNOWLEDGE_ACTIONS: KnowledgeAction[] = ["promote", "retire", "shadow"]

/**
 * The HUMAN gate (§2.3.3) — promote / retire / shadow a learned skill_knowledge row. super_admin only
 * (capability `knowledge.manage`). This is the only path a question_demand or any global-scope change
 * reaches `active`. RETIRE/ROLLBACK is instant + deploy-free: the status flip drops the row from the
 * next prompt build / score (the loaders read by status). GROUNDING is untouched — promoting a row
 * only lets its distilled snippet INFORM the prompt; it never becomes a citable evidenceRef.
 *
 * Audited: every transition is logged (action, target, from→to) for the append-only admin log.
 */
export const reviewKnowledgeRow = withAdminAction(
  "knowledge.manage",
  async (ctx, rowId: string, action: KnowledgeAction): Promise<ActionResult> => {
    if (!rowId || typeof rowId !== "string") return { ok: false, error: "Missing row id." }
    if (!KNOWLEDGE_ACTIONS.includes(action)) return { ok: false, error: `Unknown action: ${action}` }

    const supabase = createAdminSupabaseClient()

    // Load the row to validate the transition against its CURRENT status (a stale UI can't request an
    // incoherent flip). We select loose (the table isn't in the generated types).
    const { data: row, error: readErr } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> }
        }
      }
    })
      .from("skill_knowledge")
      .select("id, skill_id, scope, learning_kind, title, status")
      .eq("id", rowId)
      .maybeSingle()

    if (readErr) return { ok: false, error: readErr.message }
    if (!row) return { ok: false, error: "That learning row no longer exists." }

    const current = String(row.status ?? "") as KnowledgeStatus
    if (!isAllowedTransition(current, action)) {
      return { ok: false, error: `Cannot ${action} a row that is currently ${current || "unknown"}.` }
    }
    const target = targetStatusFor(action)

    const { error: updErr } = await (supabase as unknown as {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
      }
    })
      .from("skill_knowledge")
      .update({ status: target, updated_at: new Date().toISOString() })
      .eq("id", rowId)

    if (updErr) return { ok: false, error: updErr.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "knowledge.review",
      targetType: "skill_knowledge",
      targetId: rowId,
      details: {
        skill_id: String(row.skill_id ?? ""),
        scope: String(row.scope ?? ""),
        learning_kind: String(row.learning_kind ?? ""),
        title: String(row.title ?? ""),
        transition: { from: current, to: target, action },
      },
    })

    revalidatePath("/admin/knowledge-review")
    const verb = action === "promote" ? "promoted to active" : action === "retire" ? "retired" : "moved to shadow"
    return { ok: true, message: `Learning ${verb}.` }
  },
)
