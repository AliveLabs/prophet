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

  sendEmail({
    to: normalizedEmail,
    subject: "You've been invited to Vatic",
    react: WaitlistInvitation({
      name: fullName,
      magicLinkUrl,
    }),
  }).catch((err) => console.error("User invite email failed:", err))

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "user.invite",
    targetType: "user",
    targetId: newUser.user.id,
    details: { email: normalizedEmail, fullName },
  })

  revalidatePath("/admin/users")
  return { ok: true, message: `Invited ${normalizedEmail} successfully.` }
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

  sendEmail({
    to: userData.user.email,
    subject: "Your Vatic sign-in link",
    react: WaitlistInvitation({
      name: fullName,
      magicLinkUrl,
    }),
  }).catch((err) => console.error("Magic link email failed:", err))

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "user.send_magic_link",
    targetType: "user",
    targetId: userId,
  })

  revalidatePath(`/admin/users/${userId}`)
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
