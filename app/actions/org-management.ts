"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { logAdminAction } from "@/lib/admin/activity-log"
import { TRIAL_DURATION_DAYS } from "@/lib/billing/trial"
import { cascadeDeleteOrganization, refreshOrgData } from "@/lib/admin/cascade-cleanup"
import { createOrgWithOwner } from "@/lib/admin/org-factory"

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

const VALID_TIERS = ["entry", "mid", "top", "suspended"] as const

export async function updateOrgTier(
  orgId: string,
  newTier: string
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
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
    adminId: admin.id,
    adminEmail: admin.email ?? "",
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

export async function extendOrgTrial(
  orgId: string,
  additionalDays: number
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
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
    adminId: admin.id,
    adminEmail: admin.email ?? "",
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

export async function resetOrgTrial(orgId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
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
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "org.reset_trial",
    targetType: "org",
    targetId: orgId,
    details: { orgName: org.name },
  })

  revalidatePath("/admin/organizations")
  revalidatePath(`/admin/organizations/${orgId}`)
  return { ok: true, message: `Reset trial for ${org.name}.` }
}

export async function deactivateOrg(orgId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, subscription_tier")
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

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "org.deactivate",
    targetType: "org",
    targetId: orgId,
    details: { orgName: org.name, previousTier: org.subscription_tier },
  })

  revalidatePath("/admin/organizations")
  revalidatePath(`/admin/organizations/${orgId}`)
  return { ok: true, message: `Deactivated ${org.name}.` }
}

export async function activateOrg(orgId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
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
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "org.activate",
    targetType: "org",
    targetId: orgId,
    details: { orgName: org.name },
  })

  revalidatePath("/admin/organizations")
  revalidatePath(`/admin/organizations/${orgId}`)
  return { ok: true, message: `Activated ${org.name} with a fresh trial.` }
}

export async function updateOrgInfo(
  orgId: string,
  updates: { name?: string; billingEmail?: string }
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const dbUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (updates.name) dbUpdates.name = updates.name
  if (updates.billingEmail) dbUpdates.billing_email = updates.billingEmail

  const { error } = await supabase
    .from("organizations")
    .update(dbUpdates)
    .eq("id", orgId)

  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "org.update_info",
    targetType: "org",
    targetId: orgId,
    details: updates,
  })

  revalidatePath("/admin/organizations")
  revalidatePath(`/admin/organizations/${orgId}`)
  return { ok: true, message: "Organization info updated." }
}

const VALID_ORG_KINDS = ["real", "demo", "test"] as const

// Fully delete an org and everything under it (routes through the canonical cleanup
// module, so the polymorphic social rows are handled). Irreversible — typed-confirm
// is enforced in the UI.
export async function deleteOrg(orgId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle()
  if (!org) return { ok: false, error: "Organization not found." }

  const { data: me } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", admin.id)
    .maybeSingle()
  if (me?.current_organization_id === orgId) {
    return {
      ok: false,
      error: "You cannot delete the organization you are currently in. Switch organizations first.",
    }
  }

  let result
  try {
    result = await cascadeDeleteOrganization(supabase, orgId)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to delete organization.",
    }
  }

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "org.delete",
    targetType: "org",
    targetId: orgId,
    details: { ...result },
  })

  revalidatePath("/admin/organizations")
  return { ok: true, message: `Deleted ${org.name} and all its data.` }
}

// Wipe an org's data while keeping the org row, members, and billing identity.
//   'all'     -> drop locations + all data (back to pre-onboarding; re-onboardable).
//   'refresh' -> keep locations + competitors, wipe only derived intelligence.
// TODO(phase-2): refuse / stop in-flight signal_jobs before clearing so a live
// pipeline can't write rows back after the wipe.
export async function clearOrgData(
  orgId: string,
  mode: "all" | "refresh" = "all"
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle()
  if (!org) return { ok: false, error: "Organization not found." }

  if (mode === "refresh") {
    let result
    try {
      result = await refreshOrgData(supabase, orgId)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Failed to refresh data." }
    }
    await logAdminAction({
      adminId: admin.id,
      adminEmail: admin.email ?? "",
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

  let result
  try {
    result = await cascadeDeleteOrganization(supabase, orgId, { keepShell: true })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to clear data." }
  }
  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "org.clear_all",
    targetType: "org",
    targetId: orgId,
    details: { ...result },
  })
  revalidatePath("/admin/organizations")
  revalidatePath(`/admin/organizations/${orgId}`)
  return {
    ok: true,
    message: `Cleared all data for ${org.name} — org, members, and billing kept; ready to re-onboard.`,
  }
}

// Reassign org ownership (e.g. a manager leaves). The previous owner is demoted to
// member (kept for history), not removed.
export async function transferOrgOwnership(
  orgId: string,
  fromUserId: string,
  toUserId: string
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
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
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "org.transfer_ownership",
    targetType: "org",
    targetId: orgId,
    details: { orgName: org.name, fromUserId, toUserId },
  })

  revalidatePath(`/admin/organizations/${orgId}`)
  return { ok: true, message: `Transferred ownership of ${org.name}.` }
}

// Classify an org as Customer / Demo / Test. Reclassifying TO Customer is gated
// (makes it billable + removes it from the clear-test blast radius) until roles ship.
export async function setOrgKind(
  orgId: string,
  kind: "real" | "demo" | "test"
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
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
    return {
      ok: false,
      error:
        "Reclassifying an org to Customer requires a super-admin (coming in the roles phase).",
    }
  }

  const { error } = await supabase
    .from("organizations")
    .update({ org_kind: kind, updated_at: new Date().toISOString() })
    .eq("id", orgId)
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
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

// Demo/test orgs are created ONLY from the admin panel: owned by the logged-in
// admin, tagged demo/test, on a long (1yr) clock-only trial so they don't expire
// mid-demo. No Stripe customer. They're excluded from real metrics + billing and
// are the only orgs clear-test may delete.
const DEMO_TEST_TRIAL_DAYS = 365

type CreateOrgResult =
  | { ok: true; orgId: string; message: string }
  | { ok: false; error: string }

async function createAdminOwnedOrg(
  kind: "demo" | "test",
  input: { name: string; industryType?: "restaurant" | "liquor_store" }
): Promise<CreateOrgResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const name = input.name?.trim()
  if (!name) return { ok: false, error: "Organization name is required." }

  try {
    const { orgId } = await createOrgWithOwner(supabase, {
      ownerUserId: admin.id,
      orgName: name,
      billingEmail: admin.email ?? null,
      industryType: input.industryType ?? "restaurant",
      orgKind: kind,
      trialDays: DEMO_TEST_TRIAL_DAYS,
    })

    await logAdminAction({
      adminId: admin.id,
      adminEmail: admin.email ?? "",
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

export async function createDemoOrg(input: {
  name: string
  industryType?: "restaurant" | "liquor_store"
}): Promise<CreateOrgResult> {
  return createAdminOwnedOrg("demo", input)
}

export async function createTestOrg(input: {
  name: string
  industryType?: "restaurant" | "liquor_store"
}): Promise<CreateOrgResult> {
  return createAdminOwnedOrg("test", input)
}
