"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { logAdminAction } from "@/lib/admin/activity-log"
import { sendEmail } from "@/lib/email/send"
import { WaitlistInvitation } from "@/lib/email/templates/waitlist-invitation"

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

export async function listPlatformUsers() {
  await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { data: authData } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name, current_organization_id, created_at")

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("user_id, organization_id, role")

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p])
  )
  const membershipMap = new Map<string, typeof memberships>()
  for (const m of memberships ?? []) {
    const list = membershipMap.get(m.user_id) ?? []
    list.push(m)
    membershipMap.set(m.user_id, list)
  }

  return (authData?.users ?? []).map((u) => {
    const profile = profileMap.get(u.id)
    const orgs = membershipMap.get(u.id) ?? []
    return {
      id: u.id,
      email: u.email ?? "",
      fullName:
        profile?.full_name ??
        (u.user_metadata?.full_name as string | undefined) ??
        null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      isBanned: !!u.banned_until && new Date(u.banned_until) > new Date(),
      orgCount: orgs.length,
      hasOnboarded: !!profile?.current_organization_id,
    }
  })
}

export async function inviteNewUser(
  email: string,
  fullName?: string
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()
  const normalizedEmail = email.toLowerCase().trim()

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: "Please enter a valid email address." }
  }

  const { data: authData } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  const existing = authData?.users?.find((u) => u.email === normalizedEmail)

  if (existing) {
    return { ok: false, error: "A user with this email already exists." }
  }

  const { data: newUser, error: createError } =
    await supabase.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    })

  if (createError || !newUser.user) {
    return {
      ok: false,
      error: createError?.message ?? "Failed to create user account.",
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  const { data: linkData } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: normalizedEmail,
    options: { redirectTo: `${appUrl}/auth/callback` },
  })

  const magicLinkUrl =
    linkData?.properties?.action_link ?? `${appUrl}/login`

  const emailResult = await sendEmail({
    to: normalizedEmail,
    subject: "You've been invited to Ticket",
    react: WaitlistInvitation({
      name: fullName,
      magicLinkUrl,
    }),
    clientFacing: true,
    overrideClientEmailPause: true,
  })

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "user.invite",
    targetType: "user",
    targetId: newUser.user.id,
    details: { email: normalizedEmail, fullName },
  })

  revalidatePath("/admin/users")

  if (!emailResult.ok) {
    return { ok: true, message: `Created ${normalizedEmail} but invitation email failed to send.` }
  }

  return { ok: true, message: `Invited ${normalizedEmail} — invitation email sent.` }
}

export async function updateUserProfile(
  userId: string,
  updates: { fullName?: string; email?: string }
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const authUpdates: Record<string, unknown> = {}
  if (updates.email) authUpdates.email = updates.email.toLowerCase().trim()
  if (updates.fullName !== undefined)
    authUpdates.user_metadata = { full_name: updates.fullName }

  if (Object.keys(authUpdates).length > 0) {
    const { error } = await supabase.auth.admin.updateUserById(
      userId,
      authUpdates
    )
    if (error) return { ok: false, error: error.message }
  }

  const profileUpdates: Record<string, unknown> = {}
  if (updates.fullName !== undefined)
    profileUpdates.full_name = updates.fullName
  if (updates.email) profileUpdates.email = updates.email.toLowerCase().trim()

  if (Object.keys(profileUpdates).length > 0) {
    await supabase
      .from("profiles")
      .update(profileUpdates)
      .eq("id", userId)
  }

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "user.update_profile",
    targetType: "user",
    targetId: userId,
    details: updates,
  })

  revalidatePath("/admin/users")
  revalidatePath(`/admin/users/${userId}`)
  return { ok: true, message: "User profile updated." }
}

export async function deactivateUser(userId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  })

  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "user.deactivate",
    targetType: "user",
    targetId: userId,
  })

  revalidatePath("/admin/users")
  revalidatePath(`/admin/users/${userId}`)
  return { ok: true, message: "User deactivated." }
}

export async function activateUser(userId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  })

  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "user.activate",
    targetType: "user",
    targetId: userId,
  })

  revalidatePath("/admin/users")
  revalidatePath(`/admin/users/${userId}`)
  return { ok: true, message: "User activated." }
}

export async function sendUserMagicLink(
  userId: string
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { data: userData } = await supabase.auth.admin.getUserById(userId)
  if (!userData?.user?.email) {
    return { ok: false, error: "User not found or has no email." }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  const { data: linkData, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  })

  if (error) return { ok: false, error: error.message }

  const magicLinkUrl =
    linkData?.properties?.action_link ?? `${appUrl}/login`

  const fullName = userData.user.user_metadata?.full_name as string | undefined

  const emailResult = await sendEmail({
    to: userData.user.email,
    subject: "Your Ticket sign-in link",
    react: WaitlistInvitation({
      name: fullName,
      magicLinkUrl,
    }),
    clientFacing: true,
    overrideClientEmailPause: true,
  })

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "user.send_magic_link",
    targetType: "user",
    targetId: userId,
  })

  revalidatePath(`/admin/users/${userId}`)

  if (!emailResult.ok) {
    return { ok: false, error: `Failed to send magic link email to ${userData.user.email}.` }
  }

  return { ok: true, message: `Magic link sent to ${userData.user.email}.` }
}

export async function impersonateUser(
  userId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { data: userData } = await supabase.auth.admin.getUserById(userId)
  if (!userData?.user?.email) {
    return { ok: false, error: "User not found or has no email." }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  const { data: linkData, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  })

  if (error) return { ok: false, error: error.message }

  const url =
    linkData?.properties?.action_link ?? `${appUrl}/login`

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "user.impersonate",
    targetType: "user",
    targetId: userId,
    details: { email: userData.user.email },
  })

  return { ok: true, url }
}

export async function deleteUser(userId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { data: userData } = await supabase.auth.admin.getUserById(userId)
  if (!userData?.user) {
    return { ok: false, error: "User not found." }
  }

  const userEmail = userData.user.email ?? ""

  if (admin.id === userId) {
    return { ok: false, error: "You cannot delete your own account." }
  }

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)

  const orgIds = (memberships ?? []).map((m) => m.organization_id)

  const soleOwnerOrgIds: string[] = []
  const multiMemberOrgIds: string[] = []

  for (const orgId of orgIds) {
    const { count } = await supabase
      .from("organization_members")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)

    if ((count ?? 0) <= 1) {
      soleOwnerOrgIds.push(orgId)
    } else {
      multiMemberOrgIds.push(orgId)
    }
  }

  for (const orgId of soleOwnerOrgIds) {
    const { data: locations } = await supabase
      .from("locations")
      .select("id")
      .eq("organization_id", orgId)

    const locationIds = (locations ?? []).map((l) => l.id)

    const { data: competitors } = await supabase
      .from("competitors")
      .select("id")
      .in("location_id", locationIds.length > 0 ? locationIds : ["__none__"])

    const competitorIds = (competitors ?? []).map((c) => c.id)

    if (locationIds.length > 0) {
      await supabase
        .from("social_profiles")
        .delete()
        .eq("entity_type", "location")
        .in("entity_id", locationIds)
    }

    if (competitorIds.length > 0) {
      await supabase
        .from("social_profiles")
        .delete()
        .eq("entity_type", "competitor")
        .in("entity_id", competitorIds)
    }
  }

  await supabase
    .from("profiles")
    .update({ current_organization_id: null })
    .eq("id", userId)

  for (const orgId of multiMemberOrgIds) {
    await supabase
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", userId)
  }

  for (const orgId of soleOwnerOrgIds) {
    await supabase.from("organizations").delete().eq("id", orgId)
  }

  await supabase.from("platform_admins").delete().eq("user_id", userId)

  if (userEmail) {
    await supabase
      .from("waitlist_signups")
      .update({
        status: "declined",
        admin_notes: "User account deleted by admin",
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("email", userEmail.toLowerCase())
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)

  if (deleteError) {
    return { ok: false, error: `Failed to delete auth user: ${deleteError.message}` }
  }

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "user.delete",
    targetType: "user",
    targetId: userId,
    details: {
      email: userEmail,
      soleOwnerOrgsDeleted: soleOwnerOrgIds.length,
      multiMemberOrgsLeft: multiMemberOrgIds.length,
    },
  })

  revalidatePath("/admin/users")
  revalidatePath("/admin/waitlist")
  return {
    ok: true,
    message: `Deleted ${userEmail} and ${soleOwnerOrgIds.length} sole-owner org(s). Waitlist status reset for reapply.`,
  }
}
