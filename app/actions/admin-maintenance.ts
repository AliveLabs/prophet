"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { withAdminAction } from "@/lib/auth/with-admin-action"
import { logAdminAction, logCriticalAction } from "@/lib/admin/activity-log"
import {
  cascadeDeleteOrganization,
  type CascadeDeleteResult,
} from "@/lib/admin/cascade-cleanup"

export interface ClearTestTarget {
  id: string
  name: string
  orgKind: string
  paymentState: string | null
}

export type ClearTestResult =
  | { ok: true; dryRun: true; count: number; targets: ClearTestTarget[] }
  | { ok: true; dryRun: false; count: number; deleted: CascadeDeleteResult[] }
  | { ok: false; error: string }

// Bulk-delete demo/test orgs (the productized, guarded version of the 2026-06-22
// one-off clear). Defaults to a DRY RUN that returns exactly what would be deleted;
// the caller must explicitly pass dryRun:false (behind a typed-count confirm in the
// UI) to actually delete. Fail-closed: never touches a Customer org or one with a
// live Stripe subscription.
export const clearTestData = withAdminAction(
  "demo.manage",
  async (
    ctx,
    opts: {
      includeDemo?: boolean
      allowlistOrgIds?: string[]
      dryRun?: boolean
      reason?: string
    } = {}
  ): Promise<ClearTestResult> => {
  const { includeDemo = false, allowlistOrgIds = [], dryRun = true, reason = "" } = opts
  const supabase = createAdminSupabaseClient()

  const kinds = includeDemo ? ["test", "demo"] : ["test"]
  const { data: candidates, error } = await supabase
    .from("organizations")
    .select("id, name, org_kind, payment_state")
    .in("org_kind", kinds)
  if (error) return { ok: false, error: error.message }

  const allow = new Set(allowlistOrgIds)
  const LIVE_BILLING = ["active", "trialing", "past_due"]
  const targets = (candidates ?? []).filter(
    (o) =>
      !allow.has(o.id) &&
      !(o.payment_state && LIVE_BILLING.includes(o.payment_state))
  )

  // Fail-closed: a Customer org must never be in the delete set. The kind filter
  // already excludes them; this is the non-negotiable second guard.
  if (targets.some((o) => o.org_kind === "real")) {
    return { ok: false, error: "Aborted: a Customer (real) org appeared in the target set." }
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      count: targets.length,
      targets: targets.map((o) => ({
        id: o.id,
        name: o.name,
        orgKind: o.org_kind,
        paymentState: o.payment_state,
      })),
    }
  }

  // "no log ⇒ no action": record the full target set + reason before bulk-deleting.
  const intent = await logCriticalAction({
    adminId: ctx.adminId,
    adminEmail: ctx.adminEmail,
    action: "admin.clear_test_data",
    targetType: "maintenance",
    targetId: "clear_test_data",
    reason,
    before: {
      includeDemo,
      allowlistOrgIds,
      targets: targets.map((o) => ({ id: o.id, name: o.name, orgKind: o.org_kind })),
    },
    details: { phase: "intent", count: targets.length },
  })
  if (!intent.ok) return intent

  const deleted: CascadeDeleteResult[] = []
  for (const o of targets) {
    try {
      deleted.push(await cascadeDeleteOrganization(supabase, o.id))
    } catch (e) {
      return {
        ok: false,
        error: `Failed deleting ${o.name}: ${e instanceof Error ? e.message : "unknown error"}. ${deleted.length} org(s) already deleted.`,
      }
    }
  }

  await logAdminAction({
    adminId: ctx.adminId,
    adminEmail: ctx.adminEmail,
    action: "admin.clear_test_data",
    targetType: "maintenance",
    targetId: "clear_test_data",
    reason,
    details: {
      phase: "result",
      includeDemo,
      allowlistOrgIds,
      count: deleted.length,
      orgIds: deleted.map((d) => d.orgId),
    },
  })

  revalidatePath("/admin/organizations")
  revalidatePath("/admin/sandbox")
  return { ok: true, dryRun: false, count: deleted.length, deleted }
  }
)
