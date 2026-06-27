"use server"

import { revalidatePath } from "next/cache"
import { randomUUID } from "node:crypto"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  withAdminAction,
  requireSuperAdmin,
  type AdminActionContext,
} from "@/lib/auth/with-admin-action"
import { logAdminAction, logCriticalAction } from "@/lib/admin/activity-log"
import { TRIAL_DURATION_DAYS } from "@/lib/billing/trial"
import { cascadeDeleteOrganization, refreshOrgData } from "@/lib/admin/cascade-cleanup"
import { createOrgWithOwner } from "@/lib/admin/org-factory"
import { getStripeClient } from "@/lib/stripe/client"
import { resolvePriceIdOrThrow } from "@/lib/stripe/pricing"
import { isValidIndustryType } from "@/lib/verticals"

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

const VALID_TIERS = ["entry", "mid", "top", "suspended"] as const

export const updateOrgTier = withAdminAction(
  "org.manage",
  async (ctx, orgId: string, newTier: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    if (!VALID_TIERS.includes(newTier as (typeof VALID_TIERS)[number])) {
      return { ok: false, error: `Invalid tier: ${newTier}` }
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, subscription_tier")
      .eq("id", orgId)
      .single()

    if (!org) return { ok: false, error: "Organization not found." }

    const previousTier = org.subscription_tier

    const { error } = await supabase
      .from("organizations")
      .update({ subscription_tier: newTier, updated_at: new Date().toISOString() })
      .eq("id", orgId)

    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.change_tier",
      targetType: "org",
      targetId: orgId,
      details: { orgName: org.name, previousTier, newTier },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return {
      ok: true,
      message: `Changed ${org.name} from ${previousTier} to ${newTier}.`,
    }
  }
)

export const extendOrgTrial = withAdminAction(
  "org.manage",
  async (ctx, orgId: string, additionalDays: number): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, trial_ends_at")
      .eq("id", orgId)
      .single()

    if (!org) return { ok: false, error: "Organization not found." }

    const baseDate =
      org.trial_ends_at && new Date(org.trial_ends_at) > new Date()
        ? new Date(org.trial_ends_at)
        : new Date()

    const newEnd = new Date(
      baseDate.getTime() + additionalDays * 24 * 60 * 60 * 1000
    )

    const { error } = await supabase
      .from("organizations")
      .update({
        trial_ends_at: newEnd.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orgId)

    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.extend_trial",
      targetType: "org",
      targetId: orgId,
      details: {
        orgName: org.name,
        additionalDays,
        newTrialEnd: newEnd.toISOString(),
      },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return {
      ok: true,
      message: `Extended trial by ${additionalDays} days (until ${newEnd.toLocaleDateString()}).`,
    }
  }
)

export const resetOrgTrial = withAdminAction(
  "org.manage",
  async (ctx, orgId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", orgId)
      .single()

    if (!org) return { ok: false, error: "Organization not found." }

    const now = new Date()
    const trialEnd = new Date(
      now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000
    )

    // A reset trial is a fresh clock-only trial of the mid tier (trials are OF
    // Tier 2); clearing payment_state lets the clock gate access again.
    const { error } = await supabase
      .from("organizations")
      .update({
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
        subscription_tier: "mid",
        payment_state: null,
        updated_at: now.toISOString(),
      })
      .eq("id", orgId)

    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.reset_trial",
      targetType: "org",
      targetId: orgId,
      details: { orgName: org.name },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return { ok: true, message: `Reset trial for ${org.name}.` }
  }
)

export const deactivateOrg = withAdminAction(
  "org.manage",
  async (ctx, orgId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, subscription_tier, stripe_subscription_id, payment_state")
      .eq("id", orgId)
      .single()

    if (!org) return { ok: false, error: "Organization not found." }

    const { error } = await supabase
      .from("organizations")
      .update({
        subscription_tier: "suspended",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orgId)

    if (error) return { ok: false, error: error.message }

    // Cancel a live Stripe subscription so we don't keep billing a suspended org;
    // the webhook then mirrors payment_state=canceled. Best-effort: a Stripe error
    // doesn't undo the suspension, but it's logged for follow-up.
    let stripeCanceled = false
    const LIVE = ["active", "trialing", "past_due", "incomplete"]
    if (org.stripe_subscription_id && org.payment_state && LIVE.includes(org.payment_state)) {
      try {
        await getStripeClient().subscriptions.cancel(org.stripe_subscription_id)
        stripeCanceled = true
      } catch (e) {
        await logAdminAction({
          adminId: ctx.adminId,
          adminEmail: ctx.adminEmail,
          action: "org.deactivate.stripe_cancel_failed",
          targetType: "org",
          targetId: orgId,
          details: { orgName: org.name, error: e instanceof Error ? e.message : "unknown" },
        })
      }
    }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.deactivate",
      targetType: "org",
      targetId: orgId,
      details: { orgName: org.name, previousTier: org.subscription_tier, stripeCanceled },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return {
      ok: true,
      message: `Deactivated ${org.name}${stripeCanceled ? " (Stripe subscription canceled)" : ""}.`,
    }
  }
)

export const activateOrg = withAdminAction(
  "org.manage",
  async (ctx, orgId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", orgId)
      .single()

    if (!org) return { ok: false, error: "Organization not found." }

    const now = new Date()
    const trialEnd = new Date(
      now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000
    )

    // Re-activation = a fresh clock-only trial of the mid tier (trials are OF
    // Tier 2); clearing payment_state lets the clock gate access again.
    const { error } = await supabase
      .from("organizations")
      .update({
        subscription_tier: "mid",
        payment_state: null,
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", orgId)

    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.activate",
      targetType: "org",
      targetId: orgId,
      details: { orgName: org.name },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return { ok: true, message: `Activated ${org.name} with a fresh trial.` }
  }
)

export const updateOrgInfo = withAdminAction(
  "org.manage",
  async (
    ctx,
    orgId: string,
    updates: {
      name?: string
      billingEmail?: string
      slug?: string
      industryType?: "restaurant" | "liquor_store"
    }
  ): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    if (updates.industryType && !isValidIndustryType(updates.industryType)) {
      return { ok: false, error: `Invalid industry type: ${updates.industryType}` }
    }

    const dbUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }
    if (updates.name) dbUpdates.name = updates.name
    if (updates.billingEmail) dbUpdates.billing_email = updates.billingEmail
    if (updates.slug) dbUpdates.slug = updates.slug.trim().toLowerCase()
    if (updates.industryType) dbUpdates.industry_type = updates.industryType

    const { error } = await supabase
      .from("organizations")
      .update(dbUpdates)
      .eq("id", orgId)

    if (error) {
      if (error.code === "23505") return { ok: false, error: "That slug is already taken." }
      return { ok: false, error: error.message }
    }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.update_info",
      targetType: "org",
      targetId: orgId,
      details: updates,
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return { ok: true, message: "Organization info updated." }
  }
)

const VALID_ORG_KINDS = ["real", "demo", "test"] as const

// SOFT-delete an org (Phase 6c): set deleted_at so it's hidden from every list / count /
// cron and from customer access, but recoverable. A super_admin can later permanently
// purge it (purgeOrg) or anyone can restore it (restoreOrg). An admin may delete a
// demo/test org; deleting a Customer (real) org additionally requires super_admin.
export const deleteOrg = withAdminAction(
  "org.delete",
  async (ctx, orgId: string, reason: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    // Full-row snapshot for the audit trail (handoff: "full snapshot on deletes").
    const { data: org } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found." }
    if (org.deleted_at) return { ok: false, error: "Organization is already deleted." }

    // Customer (real) orgs are the billable, irreplaceable ones — gate their deletion
    // behind super_admin (checked before any write).
    if (org.org_kind === "real") {
      requireSuperAdmin(ctx, "Deleting a Customer organization requires a super admin.")
    }

    const { data: me } = await supabase
      .from("profiles")
      .select("current_organization_id")
      .eq("id", ctx.adminId)
      .maybeSingle()
    if (me?.current_organization_id === orgId) {
      return {
        ok: false,
        error: "You cannot delete the organization you are currently in. Switch organizations first.",
      }
    }

    // "no log ⇒ no action": record the intent + reason + full before-snapshot BEFORE the
    // write. If the audit row can't be written, abort.
    const intent = await logCriticalAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.soft_delete",
      targetType: "org",
      targetId: orgId,
      reason,
      before: org,
      details: { phase: "intent", orgKind: org.org_kind },
    })
    if (!intent.ok) return intent

    const { error } = await supabase
      .from("organizations")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", orgId)
    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.soft_delete",
      targetType: "org",
      targetId: orgId,
      reason,
      details: { phase: "result", orgKind: org.org_kind },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return {
      ok: true,
      message: `Deleted ${org.name} — hidden everywhere and recoverable. A super admin can permanently purge it.`,
    }
  }
)

// Permanently purge a SOFT-deleted org (Phase 6c, super_admin only). Routes through the
// canonical cascade so the polymorphic social rows are handled. Irreversible.
export const purgeOrg = withAdminAction(
  "org.delete",
  async (ctx, orgId: string, reason: string): Promise<ActionResult> => {
    requireSuperAdmin(ctx, "Permanently purging an organization requires a super admin.")
    const supabase = createAdminSupabaseClient()

    const { data: org } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found." }
    if (!org.deleted_at) {
      return { ok: false, error: "Only a deleted org can be purged. Delete it first." }
    }

    const intent = await logCriticalAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.purge",
      targetType: "org",
      targetId: orgId,
      reason,
      before: org,
      details: { phase: "intent", orgKind: org.org_kind },
    })
    if (!intent.ok) return intent

    let result
    try {
      result = await cascadeDeleteOrganization(supabase, orgId)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to purge organization." }
    }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.purge",
      targetType: "org",
      targetId: orgId,
      reason,
      details: { phase: "result", orgKind: org.org_kind, ...result },
    })

    revalidatePath("/admin/organizations")
    return { ok: true, message: `Permanently purged ${org.name} and all its data.` }
  }
)

// Restore a soft-deleted org (Phase 6c): clears deleted_at, bringing it back everywhere.
export const restoreOrg = withAdminAction(
  "org.manage",
  async (ctx, orgId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, deleted_at")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found." }
    if (!org.deleted_at) return { ok: false, error: "This organization is not deleted." }

    const { error } = await supabase
      .from("organizations")
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq("id", orgId)
    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.restore",
      targetType: "org",
      targetId: orgId,
      details: { orgName: org.name },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return { ok: true, message: `Restored ${org.name}.` }
  }
)

// Wipe an org's data while keeping the org row, members, and billing identity.
//   'all'     -> drop locations + all data (back to pre-onboarding; re-onboardable).
//   'refresh' -> keep locations + competitors, wipe only derived intelligence.
// An admin may clear demo/test orgs and may 'refresh' any org (derived data is
// regenerable); fully clearing ('all') a Customer (real) org additionally requires
// super_admin, since it destroys their onboarded locations.
// In-flight signal_jobs: the cascade deletes the org's signal_jobs atomically, so QUEUED jobs never
// run. A job already CLAIMED by a worker can't be stopped from here, so the WORKER guards it instead:
// lib/jobs/worker.ts#runJob calls locationStillActive() at the top and bails (no writes) when the
// location/org has been cleared or (soft-)deleted — so a live pipeline can't write rows back after the wipe.
export const clearOrgData = withAdminAction(
  "demo.manage",
  async (
    ctx,
    orgId: string,
    mode: "all" | "refresh" = "all",
    reason: string = ""
  ): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, org_kind")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found." }

    if (org.org_kind === "real" && mode === "all") {
      requireSuperAdmin(
        ctx,
        "Clearing all data for a Customer organization requires a super admin. (Refresh is allowed.)"
      )
    }

    // 'refresh' only wipes regenerable derived intelligence — non-destructive, best-effort log.
    if (mode === "refresh") {
      let result
      try {
        result = await refreshOrgData(supabase, orgId)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Failed to refresh data." }
      }
      await logAdminAction({
        adminId: ctx.adminId,
        adminEmail: ctx.adminEmail,
        action: "org.refresh",
        targetType: "org",
        targetId: orgId,
        details: { orgName: org.name, ...result },
      })
      revalidatePath("/admin/organizations")
      revalidatePath(`/admin/organizations/${orgId}`)
      return {
        ok: true,
        message: `Refreshed ${org.name} — derived data wiped; locations and competitors kept.`,
      }
    }

    // 'all' drops locations + all data — destructive. Require a reason + record intent before
    // wiping ("no log ⇒ no action").
    const intent = await logCriticalAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.clear_all",
      targetType: "org",
      targetId: orgId,
      reason,
      before: { orgName: org.name, orgKind: org.org_kind },
      details: { phase: "intent" },
    })
    if (!intent.ok) return intent

    let result
    try {
      result = await cascadeDeleteOrganization(supabase, orgId, { keepShell: true })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to clear data." }
    }
    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.clear_all",
      targetType: "org",
      targetId: orgId,
      reason,
      details: { phase: "result", ...result },
    })
    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return {
      ok: true,
      message: `Cleared all data for ${org.name} — org, members, and billing kept; ready to re-onboard.`,
    }
  }
)

// Reassign org ownership (e.g. a manager leaves). The previous owner is demoted to
// member (kept for history), not removed.
export const transferOrgOwnership = withAdminAction(
  "org.manage",
  async (ctx, orgId: string, fromUserId: string, toUserId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    if (fromUserId === toUserId) {
      return { ok: false, error: "Source and target users are the same." }
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found." }

    // Promote the target to owner (insert if not yet a member).
    const { data: targetMember } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("user_id", toUserId)
      .maybeSingle()

    if (targetMember) {
      const { error } = await supabase
        .from("organization_members")
        .update({ role: "owner" })
        .eq("organization_id", orgId)
        .eq("user_id", toUserId)
      if (error) return { ok: false, error: error.message }
    } else {
      const { error } = await supabase
        .from("organization_members")
        .insert({ organization_id: orgId, user_id: toUserId, role: "owner" })
      if (error) return { ok: false, error: error.message }
    }

    // Demote every OTHER current owner to member. Don't trust a caller-supplied
    // fromUserId (which may be stale) — keying on the actual role guarantees exactly
    // one owner afterward and can't half-apply into a zero- or two-owner state.
    const { error: demoteErr } = await supabase
      .from("organization_members")
      .update({ role: "member" })
      .eq("organization_id", orgId)
      .eq("role", "owner")
      .neq("user_id", toUserId)
    if (demoteErr) return { ok: false, error: demoteErr.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.transfer_ownership",
      targetType: "org",
      targetId: orgId,
      details: { orgName: org.name, fromUserId, toUserId },
    })

    revalidatePath(`/admin/organizations/${orgId}`)
    return { ok: true, message: `Transferred ownership of ${org.name}.` }
  }
)

// Classify an org as Customer / Demo / Test. Reclassifying TO Customer (real) makes it
// billable and removes it from the clear-test blast radius, so it requires super_admin.
export const setOrgKind = withAdminAction(
  "org.manage",
  async (ctx, orgId: string, kind: "real" | "demo" | "test"): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    if (!VALID_ORG_KINDS.includes(kind)) {
      return { ok: false, error: `Invalid kind: ${kind}` }
    }

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, org_kind")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found." }

    if (kind === "real" && org.org_kind !== "real") {
      requireSuperAdmin(ctx, "Reclassifying an organization to Customer requires a super admin.")
    }

    const { error } = await supabase
      .from("organizations")
      .update({ org_kind: kind, updated_at: new Date().toISOString() })
      .eq("id", orgId)
    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.set_kind",
      targetType: "org",
      targetId: orgId,
      details: { orgName: org.name, from: org.org_kind, to: kind },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return {
      ok: true,
      message: `${org.name} is now ${kind === "real" ? "a Customer" : kind}.`,
    }
  }
)

// Demo/test orgs are created ONLY from the admin panel: owned by the logged-in
// admin, tagged demo/test, on a long (1yr) clock-only trial so they don't expire
// mid-demo. No Stripe customer. They're excluded from real metrics + billing and
// are the only orgs clear-test may delete.
const DEMO_TEST_TRIAL_DAYS = 365

type CreateOrgResult =
  | { ok: true; orgId: string; message: string }
  | { ok: false; error: string }

async function createAdminOwnedOrg(
  ctx: AdminActionContext,
  kind: "demo" | "test",
  input: { name: string; industryType?: "restaurant" | "liquor_store" }
): Promise<CreateOrgResult> {
  const supabase = createAdminSupabaseClient()

  const name = input.name?.trim()
  if (!name) return { ok: false, error: "Organization name is required." }

  try {
    const { orgId } = await createOrgWithOwner(supabase, {
      ownerUserId: ctx.adminId,
      orgName: name,
      billingEmail: ctx.adminEmail || null,
      industryType: input.industryType ?? "restaurant",
      orgKind: kind,
      trialDays: DEMO_TEST_TRIAL_DAYS,
    })

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: kind === "demo" ? "org.create_demo" : "org.create_test",
      targetType: "org",
      targetId: orgId,
      details: { orgName: name, orgKind: kind, industryType: input.industryType ?? "restaurant" },
    })

    revalidatePath("/admin/organizations")
    revalidatePath("/admin/sandbox")
    return {
      ok: true,
      orgId,
      message: `Created ${kind} org "${name}" — owned by you, non-expiring (1yr).`,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to create organization." }
  }
}

export const createDemoOrg = withAdminAction(
  "demo.manage",
  async (
    ctx,
    input: { name: string; industryType?: "restaurant" | "liquor_store" }
  ): Promise<CreateOrgResult> => createAdminOwnedOrg(ctx, "demo", input)
)

export const createTestOrg = withAdminAction(
  "demo.manage",
  async (
    ctx,
    input: { name: string; industryType?: "restaurant" | "liquor_store" }
  ): Promise<CreateOrgResult> => createAdminOwnedOrg(ctx, "test", input)
)

// Set an exact trial end date/time. For a card-backed Stripe trial, Stripe owns
// the clock — update it there and let the webhook mirror trial_ends_at (writing the
// column directly would be clobbered by the next webhook). For clock-only orgs
// (no Stripe sub / null payment_state), write the column directly. This is also the
// lever for nudging a demo/test org's expiry.
export const setTrialEndsAt = withAdminAction(
  "org.manage",
  async (ctx, orgId: string, isoDate: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const ts = Date.parse(isoDate)
    if (Number.isNaN(ts)) return { ok: false, error: "Invalid date." }
    const date = new Date(ts)

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, payment_state, stripe_subscription_id, trial_started_at")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found." }

    let viaStripe = false
    if (org.stripe_subscription_id) {
      // Stripe owns the clock for any org with a live subscription. Only a trialing
      // sub can have its trial moved; for a past-trial sub (active/past_due/…) a trial
      // date no longer applies — refuse rather than write a column the webhook clobbers.
      if (org.payment_state !== "trialing") {
        return {
          ok: false,
          error: "This org has a live Stripe subscription past its trial — a trial end date no longer applies.",
        }
      }
      // Stripe requires trial_end to be at least ~48h in the future.
      if (ts < Date.now() + 48 * 60 * 60 * 1000) {
        return { ok: false, error: "Stripe trials must end at least 48 hours out. Pick a later date." }
      }
      try {
        await getStripeClient().subscriptions.update(org.stripe_subscription_id, {
          trial_end: Math.floor(ts / 1000),
          proration_behavior: "none",
        })
        viaStripe = true
      } catch (e) {
        return {
          ok: false,
          error: `Stripe rejected the trial date: ${e instanceof Error ? e.message : "unknown error"}`,
        }
      }
    } else {
      const dbUpdates: Record<string, unknown> = {
        trial_ends_at: date.toISOString(),
        updated_at: new Date().toISOString(),
      }
      if (!org.trial_started_at) dbUpdates.trial_started_at = new Date().toISOString()
      const { error } = await supabase.from("organizations").update(dbUpdates).eq("id", orgId)
      if (error) return { ok: false, error: error.message }
    }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.set_trial_ends_at",
      targetType: "org",
      targetId: orgId,
      details: { orgName: org.name, trialEndsAt: date.toISOString(), viaStripe },
    })
    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return {
      ok: true,
      message: `Trial end set to ${date.toLocaleDateString()}${viaStripe ? " (via Stripe)" : ""}.`,
    }
  }
)

type ConvertResult =
  | { ok: true; url: string; message: string }
  | { ok: false; error: string }

// Convert a Customer org to paid by generating a Stripe Checkout link to send to
// them (decision: no admin-initiated charge — these orgs won't have a card on file).
// Completing checkout fires the webhook, which sets payment_state via
// applySubscriptionToOrg. We never write billing columns here.
export const convertOrgToPaid = withAdminAction(
  "billing.convert",
  async (
    ctx,
    orgId: string,
    opts: { tier?: "entry" | "mid" | "top"; cadence?: "monthly" | "annual" } = {}
  ): Promise<ConvertResult> => {
    const supabase = createAdminSupabaseClient()
    const tier = opts.tier ?? "mid"
    const cadence = opts.cadence ?? "monthly"

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, billing_email, industry_type, stripe_customer_id, org_kind")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found." }
    if (org.org_kind !== "real") {
      return { ok: false, error: "Only Customer orgs can be converted to paid. Reclassify it first." }
    }
    if (!isValidIndustryType(org.industry_type)) {
      return { ok: false, error: `Unknown industry type '${org.industry_type}' on this org.` }
    }

    let priceId: string
    try {
      priceId = resolvePriceIdOrThrow(org.industry_type, tier, cadence)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Price not configured." }
    }

    try {
      const stripe = getStripeClient()
      let customerId = org.stripe_customer_id
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: org.billing_email ?? undefined,
          name: org.name,
          metadata: { organization_id: org.id, industry_type: org.industry_type },
        })
        customerId = customer.id
        const { error: linkErr } = await supabase
          .from("organizations")
          .update({ stripe_customer_id: customerId })
          .eq("id", org.id)
        if (linkErr) {
          return {
            ok: false,
            error: `Created a Stripe customer but failed to link it to the org: ${linkErr.message}`,
          }
        }
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
      const session = await stripe.checkout.sessions.create(
        {
          customer: customerId,
          client_reference_id: org.id,
          line_items: [{ price: priceId, quantity: 1 }],
          mode: "subscription",
          success_url: `${appUrl}/settings/billing?upgraded=true`,
          cancel_url: `${appUrl}/settings/billing`,
          allow_promotion_codes: true,
          payment_method_collection: "always",
          subscription_data: {
            metadata: { organization_id: org.id, industry_type: org.industry_type, tier, cadence },
          },
        },
        { idempotencyKey: `admin-convert:${org.id}:${priceId}:${randomUUID()}` }
      )
      if (!session.url) return { ok: false, error: "Stripe did not return a checkout URL." }

      await logAdminAction({
        adminId: ctx.adminId,
        adminEmail: ctx.adminEmail,
        action: "org.convert_to_paid",
        targetType: "org",
        targetId: orgId,
        details: { orgName: org.name, tier, cadence, mode: "checkout_link" },
      })
      return {
        ok: true,
        url: session.url,
        message: `Checkout link created for ${org.name} (${tier} / ${cadence}). Send it to the customer to complete payment.`,
      }
    } catch (e) {
      return { ok: false, error: `Stripe error: ${e instanceof Error ? e.message : "unknown error"}` }
    }
  }
)
