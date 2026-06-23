"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { withAdminAction } from "@/lib/auth/with-admin-action"
import { logAdminAction } from "@/lib/admin/activity-log"
import { type AdminRole, isValidRole } from "@/lib/auth/capabilities"

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

const roleLabel = (r: AdminRole) => r.replace("_", " ")

// Count remaining super_admins, optionally excluding one admin row. Used to guarantee the
// LAST super_admin can never be removed or demoted — that would lock platform governance
// (only super_admins can manage admins) with no recovery path from inside the app.
async function superAdminCountExcluding(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  excludeAdminId?: string
): Promise<number> {
  let q = supabase
    .from("platform_admins")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
  if (excludeAdminId) q = q.neq("id", excludeAdminId)
  const { count } = await q
  return count ?? 0
}

export const invitePlatformAdmin = withAdminAction(
  "admin.manage",
  async (ctx, email: string, role: AdminRole = "admin"): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const normalizedEmail = email.toLowerCase().trim()
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return { ok: false, error: "Please enter a valid email address." }
    }
    if (!isValidRole(role)) {
      return { ok: false, error: `Invalid role: ${role}` }
    }

    const { data: existingAdmin } = await supabase
      .from("platform_admins")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle()

    if (existingAdmin) {
      return { ok: false, error: "This email is already a platform admin." }
    }

    const { data: authUsers } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })

    let userId: string
    const existingUser = authUsers?.users?.find(
      (u) => u.email === normalizedEmail
    )

    if (existingUser) {
      userId = existingUser.id
    } else {
      const { data: newUser, error: createError } =
        await supabase.auth.admin.createUser({
          email: normalizedEmail,
          email_confirm: true,
        })

      if (createError || !newUser.user) {
        return {
          ok: false,
          error: createError?.message ?? "Failed to create auth account.",
        }
      }
      userId = newUser.user.id

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: normalizedEmail,
        options: { redirectTo: `${appUrl}/auth/callback` },
      })
    }

    const { error: insertError } = await supabase
      .from("platform_admins")
      .insert({ user_id: userId, email: normalizedEmail, role })

    if (insertError) {
      return { ok: false, error: insertError.message }
    }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "admin.invite",
      targetType: "admin",
      targetId: userId,
      details: { email: normalizedEmail, role },
    })

    revalidatePath("/admin/settings")
    return { ok: true, message: `${normalizedEmail} is now a ${roleLabel(role)}.` }
  }
)

export const removePlatformAdmin = withAdminAction(
  "admin.manage",
  async (ctx, adminId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: target } = await supabase
      .from("platform_admins")
      .select("id, user_id, email, role")
      .eq("id", adminId)
      .single()

    if (!target) {
      return { ok: false, error: "Admin not found." }
    }

    if (target.user_id === ctx.adminId) {
      return { ok: false, error: "You cannot remove yourself." }
    }

    // Never strand governance: refuse to remove the last super_admin.
    if (
      target.role === "super_admin" &&
      (await superAdminCountExcluding(supabase, target.id)) === 0
    ) {
      return {
        ok: false,
        error: "Can't remove the last super admin. Promote another admin to super admin first.",
      }
    }

    await supabase.from("platform_admins").delete().eq("id", adminId)

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "admin.remove",
      targetType: "admin",
      targetId: target.user_id,
      details: { email: target.email, role: target.role },
    })

    revalidatePath("/admin/settings")
    return { ok: true, message: `Removed ${target.email} from platform admins.` }
  }
)

export const setPlatformAdminRole = withAdminAction(
  "admin.manage",
  async (ctx, adminId: string, role: AdminRole): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    if (!isValidRole(role)) {
      return { ok: false, error: `Invalid role: ${role}` }
    }

    const { data: target } = await supabase
      .from("platform_admins")
      .select("id, user_id, email, role")
      .eq("id", adminId)
      .single()

    if (!target) {
      return { ok: false, error: "Admin not found." }
    }

    // Consistent with removePlatformAdmin's self guard: don't let an admin change their
    // own role (prevents accidental self-demotion / self-lockout footguns).
    if (target.user_id === ctx.adminId) {
      return { ok: false, error: "You can't change your own role. Ask another super admin." }
    }

    if (target.role === role) {
      return { ok: false, error: `${target.email} is already a ${roleLabel(role)}.` }
    }

    // Never strand governance: refuse to demote the last super_admin.
    if (
      target.role === "super_admin" &&
      role !== "super_admin" &&
      (await superAdminCountExcluding(supabase, target.id)) === 0
    ) {
      return {
        ok: false,
        error: "Can't demote the last super admin. Promote another admin to super admin first.",
      }
    }

    const { error } = await supabase
      .from("platform_admins")
      .update({ role })
      .eq("id", adminId)

    if (error) return { ok: false, error: error.message }

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "admin.set_role",
      targetType: "admin",
      targetId: target.user_id,
      details: { email: target.email, from: target.role, to: role },
    })

    revalidatePath("/admin/settings")
    return { ok: true, message: `${target.email} is now a ${roleLabel(role)}.` }
  }
)
