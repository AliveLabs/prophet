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
import { shouldPointNewOwnerAtOrg } from "@/lib/onboarding/claim-current-org"
import {
  mergeSourcesIntoTarget,
  resolveMergedRole,
  type MergeSourceOutcome,
  type MergeSourcePorts,
} from "@/lib/admin/org-merge"

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

// Per-location pause (beta-rescue 1.1): a non-destructive on/off switch for the daily
// machine (data-pull cron + brief cron), mainly for demo orgs: pause them without deleting
// the org so they stop costing money on data pulls and brief builds. See
// lib/jobs/build-schedule.ts#shouldRunDailyForLocation for how the crons read the flag, and
// migration 20260812130000 for the column itself (`locations.daily_runs_enabled`, default
// true). Scoped to the org's OWN locations so an id from another org can't be toggled through
// this org's admin page.
export const setLocationDailyRunsEnabled = withAdminAction(
  "org.manage",
  async (
    ctx,
    orgId: string,
    locationId: string,
    enabled: boolean
  ): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: location } = await supabase
      .from("locations")
      .select("id, name, organization_id, daily_runs_enabled")
      .eq("id", locationId)
      .eq("organization_id", orgId)
      .maybeSingle()
    if (!location) return { ok: false, error: "Location not found on this organization." }

    const { error } = await supabase
      .from("locations")
      .update({ daily_runs_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", locationId)

    if (error) return { ok: false, error: error.message }

    // targetType/targetId "org"/orgId (not "location") so this shows up in the org detail
    // page's own activity feed alongside its siblings (that feed filters on target_type=org,
    // target_id=orgId), so the locationId/locationName live in details instead.
    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: enabled ? "location.daily_runs.enable" : "location.daily_runs.disable",
      targetType: "org",
      targetId: orgId,
      details: {
        locationId,
        locationName: location.name,
        previousValue: location.daily_runs_enabled,
        newValue: enabled,
      },
    })

    revalidatePath(`/admin/organizations/${orgId}`)
    return {
      ok: true,
      message: enabled
        ? `Daily runs resumed for ${location.name}.`
        : `Daily runs paused for ${location.name}: no data pulls or brief builds until resumed.`,
    }
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
      message: `Deleted ${org.name}: hidden everywhere and recoverable. A super admin can permanently purge it.`,
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
        message: `Refreshed ${org.name}: derived data wiped; locations and competitors kept.`,
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
      message: `Cleared all data for ${org.name}: org, members, and billing kept; ready to re-onboard.`,
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
      .select("id, name, deleted_at")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found." }
    // A soft-deleted org must not be handed to anyone: the transfer below GRANTS access
    // (owner membership) and can repoint the recipient's current_organization_id at it, which
    // would hand a live dashboard to a member of an org that was switched off. Restore it first
    // if the transfer is genuinely intended.
    if (org.deleted_at) {
      return { ok: false, error: "This organization is deleted. Restore it before transferring ownership." }
    }

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

    // Point the new owner AT the org they just received. Membership alone isn't enough:
    // /auth/callback and resolveOperator() both read only profiles.current_organization_id
    // and send a null straight to /onboarding, so without this the new owner is asked to
    // set up a restaurant from scratch while already owning one. An invited user may have
    // no profiles row at all yet (nothing creates one on signup), hence the upsert.
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id, current_organization_id")
      .eq("id", toUserId)
      .maybeSingle()

    if (shouldPointNewOwnerAtOrg(targetProfile?.current_organization_id)) {
      const { error: profileErr } = await supabase
        .from("profiles")
        .upsert({ id: toUserId, current_organization_id: orgId }, { onConflict: "id" })
      // Non-fatal: the transfer itself succeeded, and the owner can still be pointed at the
      // org by opening it in-app. Surfacing it beats silently leaving them in onboarding.
      if (profileErr) {
        console.error("[transferOrgOwnership] could not set current org:", profileErr.message)
        await logAdminAction({
          adminId: ctx.adminId,
          adminEmail: ctx.adminEmail,
          action: "org.transfer_ownership",
          targetType: "org",
          targetId: orgId,
          details: { orgName: org.name, fromUserId, toUserId, currentOrgSetFailed: profileErr.message },
        })
        revalidatePath(`/admin/organizations/${orgId}`)
        return {
          ok: true,
          message: `Transferred ownership of ${org.name}, but couldn't set their starting dashboard. They may land in onboarding.`,
        }
      }
    }

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

export type ConvertDemoResult =
  | { ok: true; message: string; steps: string[] }
  | { ok: false; error: string; steps: string[] }

// "Convert demo to customer": the packaged handover (beta rescue phase 3.5). Pairs with
// the signup-collision flow: when a real operator turns up wanting a location we run as a
// demo, app/onboarding/actions.ts captures their contact and alerts us; this is what we
// run afterwards, once we've validated they are who they say they are.
//
// It CHAINS the three existing actions rather than reimplementing any of them, in the only
// order that works:
//   1. transferOrgOwnership: hand the org (with all its data) to the real operator. Runs
//      FIRST because it refuses a soft-deleted org and is the step most likely to fail on
//      bad input; failing here leaves the org exactly as it was, still a demo.
//   2. setOrgKind('real'): reclassify, which is what makes it billable and pulls it out
//      of the clear-test blast radius. After the transfer so a half-done run never leaves
//      a billable org still owned by an admin.
//   3. resetOrgTrial: swap the demo's 1-year clock for a real 14-day mid-tier trial.
//      Last because it is the only fully reversible step.
//
// NOT atomic, and deliberately not pretending to be: each sub-action has its own audit
// entry, and `steps` reports exactly how far the chain got so an admin can finish the rest
// by hand. Stops at the first failure rather than pressing on into a stranger state.
//
// Billing beyond the trial stays manual: convertOrgToPaid generates a checkout link to
// send them (no admin-initiated charge), which is a separate decision from this handover.
export const convertDemoToCustomer = withAdminAction(
  "org.manage",
  async (ctx, orgId: string, newOwnerUserId: string, reason: string = ""): Promise<ConvertDemoResult> => {
    requireSuperAdmin(ctx, "Converting a demo organization to a customer requires a super admin.")
    const supabase = createAdminSupabaseClient()
    const steps: string[] = []

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, org_kind, deleted_at")
      .eq("id", orgId)
      .maybeSingle()
    if (!org) return { ok: false, error: "Organization not found.", steps }
    if (org.deleted_at) {
      return { ok: false, error: "This organization is deleted. Restore it first.", steps }
    }
    if (org.org_kind === "real") {
      return { ok: false, error: `${org.name} is already a Customer org.`, steps }
    }

    const currentOwner = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("role", "owner")
      .maybeSingle()
    const fromUserId = currentOwner.data?.user_id ?? ctx.adminId
    if (fromUserId === newOwnerUserId) {
      return { ok: false, error: "That user already owns this organization.", steps }
    }

    // "no log ⇒ no action": one intent row for the packaged action, on top of the audit
    // entries each sub-action writes for itself.
    const intent = await logCriticalAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.convert_demo_to_customer",
      targetType: "org",
      targetId: orgId,
      reason,
      before: { orgName: org.name, orgKind: org.org_kind, previousOwnerUserId: fromUserId },
      details: { phase: "intent", newOwnerUserId },
    })
    if (!intent.ok) return { ...intent, steps }

    const transfer = await transferOrgOwnership(orgId, fromUserId, newOwnerUserId)
    if (!transfer.ok) {
      return { ok: false, error: `Ownership transfer failed: ${transfer.error}`, steps }
    }
    steps.push(transfer.message)

    const reclassify = await setOrgKind(orgId, "real")
    if (!reclassify.ok) {
      return {
        ok: false,
        error: `Ownership moved, but reclassifying to Customer failed: ${reclassify.error}`,
        steps,
      }
    }
    steps.push(reclassify.message)

    const trial = await resetOrgTrial(orgId)
    if (!trial.ok) {
      return {
        ok: false,
        error: `Ownership moved and reclassified, but starting the trial failed: ${trial.error}`,
        steps,
      }
    }
    steps.push(trial.message)

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.convert_demo_to_customer",
      targetType: "org",
      targetId: orgId,
      reason,
      details: { phase: "result", orgName: org.name, fromUserId, newOwnerUserId, steps },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${orgId}`)
    return {
      ok: true,
      steps,
      message: `${org.name} is now a Customer org owned by the new owner, on a fresh ${TRIAL_DURATION_DAYS}-day trial. Send them a checkout link with "Convert to paid" when they're ready.`,
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
      message: `Created ${kind} org "${name}": owned by you, non-expiring (1yr).`,
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
          error: "This org has a live Stripe subscription past its trial: a trial end date no longer applies.",
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

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>

// Wires the pure ordering logic in lib/admin/org-merge.ts to real Supabase reads/writes,
// closing over the fixed targetOrgId (each source org gets its own ports call).
function buildMergePorts(supabase: AdminSupabase, targetOrgId: string): MergeSourcePorts {
  return {
    async loadSource(sourceOrgId) {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, org_kind, deleted_at")
        .eq("id", sourceOrgId)
        .maybeSingle()
      if (!data) return null
      return { id: data.id, name: data.name, orgKind: data.org_kind, deletedAt: data.deleted_at }
    },

    // Move every organization_members row from source into target. Upsert semantics: a user
    // already a target member keeps the higher of their two roles (resolveMergedRole); an
    // incoming owner arrives as admin, never owner — the target's real owner is untouched
    // because it's never in the source's row set for that user_id.
    async moveMembers(sourceOrgId) {
      const { data: sourceMembers, error: sourceErr } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", sourceOrgId)
      if (sourceErr) {
        throw new Error(`org-merge: could not read source members: ${sourceErr.message}`)
      }

      const { data: targetMembers, error: targetErr } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", targetOrgId)
      if (targetErr) {
        throw new Error(`org-merge: could not read target members: ${targetErr.message}`)
      }
      const targetRoleByUser = new Map((targetMembers ?? []).map((m) => [m.user_id, m.role]))

      let membersMoved = 0
      for (const member of sourceMembers ?? []) {
        const existingRole = targetRoleByUser.get(member.user_id) ?? null
        const resolvedRole = resolveMergedRole(existingRole, member.role)

        if (existingRole == null) {
          const { error } = await supabase
            .from("organization_members")
            .insert({ organization_id: targetOrgId, user_id: member.user_id, role: resolvedRole })
          if (error) {
            throw new Error(
              `org-merge: could not add member ${member.user_id} to target: ${error.message}`
            )
          }
        } else if (resolvedRole !== existingRole) {
          const { error } = await supabase
            .from("organization_members")
            .update({ role: resolvedRole })
            .eq("organization_id", targetOrgId)
            .eq("user_id", member.user_id)
          if (error) {
            throw new Error(
              `org-merge: could not update member ${member.user_id} role on target: ${error.message}`
            )
          }
        }
        membersMoved++
      }
      return { membersMoved }
    },

    // Repoint current_organization_id for anyone whose dashboard pointed at this source —
    // upsert, per the transferOrgOwnership precedent above, since a member row doesn't
    // guarantee a profiles row exists yet for an invited-but-never-onboarded user.
    async repointProfiles(sourceOrgId) {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("current_organization_id", sourceOrgId)
      if (error) {
        throw new Error(`org-merge: could not read profiles pointing at source: ${error.message}`)
      }

      let profilesRepointed = 0
      for (const p of profiles ?? []) {
        const { error: upsertErr } = await supabase
          .from("profiles")
          .upsert({ id: p.id, current_organization_id: targetOrgId }, { onConflict: "id" })
        if (upsertErr) {
          throw new Error(`org-merge: could not repoint profile ${p.id}: ${upsertErr.message}`)
        }
        profilesRepointed++
      }
      return { profilesRepointed }
    },

    // The gate before delete: confirm zero profiles still point at the source. Re-checks
    // rather than trusting the repoint count above, so a race (a profile switched TO the
    // source between repointProfiles and here) still blocks the delete.
    async verifyNoDanglingProfiles(sourceOrgId) {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("current_organization_id", sourceOrgId)
      if (error) {
        throw new Error(`org-merge: could not verify profile pointers: ${error.message}`)
      }
      return (count ?? 0) === 0
    },

    async deleteSource(sourceOrgId) {
      await cascadeDeleteOrganization(supabase, sourceOrgId)
    },
  }
}

export type MergeOrganizationsResult =
  | { ok: true; message: string; results: MergeSourceOutcome[] }
  | { ok: false; error: string }

// Fold N duplicate orgs into ONE canonical target — the Fog Harbor Fish House problem: one
// real restaurant, onboarded independently by 3 coworkers (beta rescue 1.2, pairs with
// ALT-576). super_admin only (this deletes the sources). No member is ever removed, only
// relocated to the target — anyone might be the one who actually evaluates the product — and
// the target's existing owner is never displaced.
//
// Ordering + idempotency live in lib/admin/org-merge.ts#mergeSourcesIntoTarget: a source's
// members and profile pointers are moved and CONFIRMED moved before that source is deleted,
// so a mid-run crash never leaves a user pointing at a deleted org, and re-running with the
// same sourceOrgIds is safe (an already-merged/missing source is skipped, not re-processed).
//
// Data loss: each merged-away source's briefs, snapshots, and other derived data die with it
// (full cascade delete, not keep_shell) — only its members and current-org pointer survive,
// moved onto the target.
export const mergeOrganizations = withAdminAction(
  "org.merge",
  async (
    ctx,
    sourceOrgIds: string[],
    targetOrgId: string,
    reason: string = ""
  ): Promise<MergeOrganizationsResult> => {
    const supabase = createAdminSupabaseClient()

    const uniqueSourceIds = Array.from(new Set(sourceOrgIds))
    if (uniqueSourceIds.length === 0) {
      return { ok: false, error: "Pick at least one source organization to merge." }
    }
    if (uniqueSourceIds.includes(targetOrgId)) {
      return { ok: false, error: "A source organization cannot be its own merge target." }
    }

    const { data: target } = await supabase
      .from("organizations")
      .select("id, name, org_kind, deleted_at")
      .eq("id", targetOrgId)
      .maybeSingle()
    if (!target) return { ok: false, error: "Target organization not found." }
    if (target.deleted_at) {
      return {
        ok: false,
        error: "The target organization is deleted. Restore it before merging into it.",
      }
    }

    // Load every source up front and validate ALL of them before moving anything — a live
    // Stripe subscription means real billing history hangs off this org, so refuse the whole
    // merge rather than cascade-delete it out from under an active subscription. Same LIVE
    // set deactivateOrg uses above.
    const LIVE_SUBSCRIPTION_STATES = ["active", "trialing", "past_due", "incomplete"]
    const { data: sources } = await supabase
      .from("organizations")
      .select("id, name, org_kind, deleted_at, stripe_subscription_id, payment_state")
      .in("id", uniqueSourceIds)

    for (const sourceId of uniqueSourceIds) {
      const source = (sources ?? []).find((s) => s.id === sourceId)
      // Missing or already-deleted sources are NOT an error here — they fall through to the
      // merge step, which treats them as already merged (idempotent re-run).
      if (!source || source.deleted_at) continue
      if (
        source.stripe_subscription_id &&
        source.payment_state &&
        LIVE_SUBSCRIPTION_STATES.includes(source.payment_state)
      ) {
        return {
          ok: false,
          error: `${source.name} has a live Stripe subscription. Cancel or transfer its billing before merging it away.`,
        }
      }
    }

    // Org kinds are logged, not enforced: nothing elsewhere in this file treats real/demo/test
    // as mutually incompatible (only org.delete/clearOrgData gate REAL orgs behind
    // super_admin, which this action already is). Recorded here so a real+demo merge is
    // visible in the audit trail, not silently blocked.
    const kindsInvolved = {
      targetKind: target.org_kind,
      sourceKinds: (sources ?? []).map((s) => ({ id: s.id, name: s.name, kind: s.org_kind })),
    }

    // "no log ⇒ no action": record intent + full context BEFORE any write. Merging deletes
    // orgs, so it's destructive like deleteOrg/purgeOrg/clearOrgData('all') and needs a reason.
    const intent = await logCriticalAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.merge",
      targetType: "org",
      targetId: targetOrgId,
      reason,
      before: kindsInvolved,
      details: { phase: "intent", sourceOrgIds: uniqueSourceIds },
    })
    if (!intent.ok) return intent

    const results = await mergeSourcesIntoTarget(
      uniqueSourceIds,
      buildMergePorts(supabase, targetOrgId)
    )

    const merged = results.filter((r) => r.status === "merged")
    const failed = results.filter((r) => r.status === "failed")

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.merge",
      targetType: "org",
      targetId: targetOrgId,
      reason,
      details: {
        phase: "result",
        targetName: target.name,
        targetKind: target.org_kind,
        results: results.map((r) => ({
          sourceOrgId: r.sourceOrgId,
          sourceName: r.sourceName,
          sourceKind: r.sourceKind,
          status: r.status,
          membersMoved: r.membersMoved,
          profilesRepointed: r.profilesRepointed,
          error: r.error ?? null,
        })),
      },
    })

    revalidatePath("/admin/organizations")
    revalidatePath(`/admin/organizations/${targetOrgId}`)

    if (failed.length > 0) {
      const failedNames = failed.map((r) => r.sourceName ?? r.sourceOrgId).join(", ")
      return {
        ok: false,
        error: `Merged ${merged.length} of ${uniqueSourceIds.length} org(s) into ${target.name}. Failed (nothing was left half-moved, safe to retry): ${failedNames}.`,
      }
    }

    const totalMembers = merged.reduce((n, r) => n + r.membersMoved, 0)
    return {
      ok: true,
      message:
        merged.length > 0
          ? `Merged ${merged.length} org(s) into ${target.name}: ${totalMembers} membership(s) moved, duplicates deleted.`
          : `Nothing to merge: the selected org(s) were already merged or no longer exist.`,
      results,
    }
  }
)
