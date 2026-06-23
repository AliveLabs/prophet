"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requireCapability } from "@/lib/auth/platform-admin"
import { withAdminAction } from "@/lib/auth/with-admin-action"
import { logAdminAction, logCriticalAction } from "@/lib/admin/activity-log"
import { sendEmail } from "@/lib/email/send"
import { WaitlistInvitation } from "@/lib/email/templates/waitlist-invitation"
import { cascadeDeleteOrganization, findSoleOwnerOrgIds } from "@/lib/admin/cascade-cleanup"

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

export async function listPlatformUsers() {
  await requireCapability("view")
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

export const inviteNewUser = withAdminAction(
  "user.manage",
  async (ctx, email: string, fullName?: string): Promise<ActionResult> => {
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
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
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
)

export const updateUserProfile = withAdminAction(
  "user.manage",
  async (
    ctx,
    userId: string,
    updates: { fullName?: string; email?: string }
  ): Promise<ActionResult> => {
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
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "user.update_profile",
      targetType: "user",
      targetId: userId,
      details: updates,
    })

    revalidatePath("/admin/users")
    revalidatePath(`/admin/users/${userId}`)
    return { ok: true, message: "User profile updated." }
  }
)

export const deactivateUser = withAdminAction(
  "user.manage",
  async (ctx, userId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { error } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: "876000h",
    })

    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "user.deactivate",
      targetType: "user",
      targetId: userId,
    })

    revalidatePath("/admin/users")
    revalidatePath(`/admin/users/${userId}`)
    return { ok: true, message: "User deactivated." }
  }
)

export const activateUser = withAdminAction(
  "user.manage",
  async (ctx, userId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { error } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: "none",
    })

    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "user.activate",
      targetType: "user",
      targetId: userId,
    })

    revalidatePath("/admin/users")
    revalidatePath(`/admin/users/${userId}`)
    return { ok: true, message: "User activated." }
  }
)

export const sendUserMagicLink = withAdminAction(
  "user.manage",
  async (ctx, userId: string): Promise<ActionResult> => {
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
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
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
)

export const impersonateUser = withAdminAction(
  "user.impersonate",
  async (
    ctx,
    userId: string
  ): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
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
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "user.impersonate",
      targetType: "user",
      targetId: userId,
      details: { email: userData.user.email },
    })

    return { ok: true, url }
  }
)

export const deleteUser = withAdminAction(
  "user.delete",
  async (
    ctx,
    userId: string,
    opts: { orgStrategy?: "preserve" | "cascade"; reason?: string } = {}
  ): Promise<ActionResult> => {
    const { orgStrategy = "preserve", reason = "" } = opts
    const supabase = createAdminSupabaseClient()

    const { data: userData } = await supabase.auth.admin.getUserById(userId)
    if (!userData?.user) {
      return { ok: false, error: "User not found." }
    }

    const userEmail = userData.user.email ?? ""

    if (ctx.adminId === userId) {
      return { ok: false, error: "You cannot delete your own account." }
    }

    const { soleOwner, multiMember } = await findSoleOwnerOrgIds(supabase, userId)

    // Default = preserve orgs. Deleting a user must not silently burn an org's history
    // (e.g. a manager leaving). Sole-owner orgs require a transfer or an explicit opt-in.
    if (orgStrategy === "preserve" && soleOwner.length > 0) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("name")
        .in("id", soleOwner)
      const names = (orgs ?? []).map((o) => o.name).join(", ")
      return {
        ok: false,
        error: `This user is the sole owner of ${soleOwner.length} org(s): ${names}. Transfer ownership first, or retry with the cascade option to delete those orgs too.`,
      }
    }

    // Full forensic snapshot before the irreversible delete (the profiles row cascades
    // away with the auth user, so capture it now).
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()

    // "no log ⇒ no action": record intent + reason + snapshot before the irreversible
    // auth-user delete (and any org cascade). Abort if it can't be written.
    const intent = await logCriticalAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "user.delete",
      targetType: "user",
      targetId: userId,
      reason,
      before: {
        authUser: {
          id: userData.user.id,
          email: userEmail,
          createdAt: userData.user.created_at,
          lastSignInAt: userData.user.last_sign_in_at ?? null,
          metadata: userData.user.user_metadata ?? null,
        },
        profile: profileRow ?? null,
        orgStrategy,
        soleOwnerOrgIds: soleOwner,
        multiMemberOrgIds: multiMember,
      },
      details: { phase: "intent" },
    })
    if (!intent.ok) return intent

    // Detach memberships from multi-member orgs (those orgs survive).
    for (const orgId of multiMember) {
      await supabase
        .from("organization_members")
        .delete()
        .eq("organization_id", orgId)
        .eq("user_id", userId)
    }

    // cascade: fully delete the user's sole-owner orgs via the canonical module
    // (handles the polymorphic social rows the old inline logic missed).
    let soleOwnerOrgsDeleted = 0
    if (orgStrategy === "cascade") {
      for (const orgId of soleOwner) {
        try {
          await cascadeDeleteOrganization(supabase, orgId)
        } catch (e) {
          // Abort before the irreversible auth-user delete if an org cascade fails,
          // so we don't delete the login while its orgs are only half-removed.
          return {
            ok: false,
            error: `Failed to delete org ${orgId}: ${e instanceof Error ? e.message : "unknown error"}. User not deleted.`,
          }
        }
        soleOwnerOrgsDeleted++
      }
    }

    // The next three writes are intentionally best-effort / unchecked: profiles,
    // organization_members, and platform_admins all FK auth.users(id) ON DELETE
    // CASCADE, so the final auth.admin.deleteUser below removes them regardless. They
    // run first only to tidy state pre-delete. (Stricter per-write auditing of the
    // whole deleteUser flow is folded into Phase 6 hardening.)
    await supabase
      .from("profiles")
      .update({ current_organization_id: null })
      .eq("id", userId)

    await supabase.from("platform_admins").delete().eq("user_id", userId)

    if (userEmail) {
      await supabase
        .from("waitlist_signups")
        .update({
          status: "declined",
          admin_notes: "User account deleted by admin",
          reviewed_by: ctx.adminId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("email", userEmail.toLowerCase())
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)

    if (deleteError) {
      return { ok: false, error: `Failed to delete auth user: ${deleteError.message}` }
    }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "user.delete",
      targetType: "user",
      targetId: userId,
      reason,
      details: {
        phase: "result",
        email: userEmail,
        orgStrategy,
        soleOwnerOrgsDeleted,
        multiMemberOrgsLeft: multiMember.length,
      },
    })

    revalidatePath("/admin/users")
    revalidatePath("/admin/waitlist")
    return {
      ok: true,
      message:
        orgStrategy === "cascade"
          ? `Deleted ${userEmail} and ${soleOwnerOrgsDeleted} sole-owner org(s). Waitlist status reset for reapply.`
          : `Deleted ${userEmail}. Orgs preserved; waitlist status reset for reapply.`,
    }
  }
)

// Revoke a single user's membership in one org. Both the user and the org survive.
// Refuses to strand the org's sole owner (transfer ownership first).
export const removeUserFromOrg = withAdminAction(
  "user.manage",
  async (ctx, orgId: string, userId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: target } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle()
    if (!target) {
      return { ok: false, error: "User is not a member of this organization." }
    }

    // Block only if this user is the LAST owner (count remaining owners, not total
    // members — an org with [owner, member] still strands if you remove the owner).
    if (target.role === "owner") {
      const { count: otherOwners } = await supabase
        .from("organization_members")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("role", "owner")
        .neq("user_id", userId)
      if ((otherOwners ?? 0) === 0) {
        return {
          ok: false,
          error: "This user is the sole owner. Transfer ownership before removing them.",
        }
      }
    }

    await supabase
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", userId)

    const { data: prof } = await supabase
      .from("profiles")
      .select("current_organization_id")
      .eq("id", userId)
      .maybeSingle()
    if (prof?.current_organization_id === orgId) {
      await supabase
        .from("profiles")
        .update({ current_organization_id: null })
        .eq("id", userId)
    }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "org.remove_member",
      targetType: "org",
      targetId: orgId,
      details: { userId },
    })

    revalidatePath(`/admin/organizations/${orgId}`)
    revalidatePath(`/admin/users/${userId}`)
    return { ok: true, message: "Removed user from organization." }
  }
)

// "Tombstone" a user: reset their onboarding so the next login routes them back
// through the onboarding wizard. Does NOT touch org_kind, billing, members, or any
// org data — pair with clearOrgData for a true fresh-onboarding rehearsal. The
// onboarding gate is profiles.current_organization_id (app/onboarding/page.tsx).
export const tombstoneUser = withAdminAction(
  "user.manage",
  async (ctx, userId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: prof } = await supabase
      .from("profiles")
      .select("id, current_organization_id")
      .eq("id", userId)
      .maybeSingle()
    if (!prof) return { ok: false, error: "User profile not found." }

    await supabase
      .from("profiles")
      .update({ current_organization_id: null })
      .eq("id", userId)

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "user.tombstone",
      targetType: "user",
      targetId: userId,
      details: { previousCurrentOrg: prof.current_organization_id },
    })

    revalidatePath(`/admin/users/${userId}`)
    return {
      ok: true,
      message:
        "User reset to onboarding. Note: they resume their existing org (with its data) unless you also Clear all data for it.",
    }
  }
)
