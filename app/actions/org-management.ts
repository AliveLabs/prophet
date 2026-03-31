"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { logAdminAction } from "@/lib/admin/activity-log"
import { TRIAL_DURATION_DAYS } from "@/lib/billing/trial"

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

const VALID_TIERS = ["free", "starter", "pro", "agency"] as const

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

  const { error } = await supabase
    .from("organizations")
    .update({
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      subscription_tier: "free",
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

  const { error } = await supabase
    .from("organizations")
    .update({
      subscription_tier: "free",
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
