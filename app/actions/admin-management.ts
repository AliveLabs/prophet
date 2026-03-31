"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { logAdminAction } from "@/lib/admin/activity-log"

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

export async function invitePlatformAdmin(
  email: string
): Promise<ActionResult> {
  const caller = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const normalizedEmail = email.toLowerCase().trim()
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: "Please enter a valid email address." }
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
    .insert({ user_id: userId, email: normalizedEmail })

  if (insertError) {
    return { ok: false, error: insertError.message }
  }

  await logAdminAction({
    adminId: caller.id,
    adminEmail: caller.email ?? "",
    action: "admin.invite",
    targetType: "admin",
    targetId: userId,
    details: { email: normalizedEmail },
  })

  revalidatePath("/admin/settings")
  return { ok: true, message: `${normalizedEmail} is now a platform admin.` }
}

export async function removePlatformAdmin(
  adminId: string
): Promise<ActionResult> {
  const caller = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  const { data: target } = await supabase
    .from("platform_admins")
    .select("id, user_id, email")
    .eq("id", adminId)
    .single()

  if (!target) {
    return { ok: false, error: "Admin not found." }
  }

  if (target.user_id === caller.id) {
    return { ok: false, error: "You cannot remove yourself." }
  }

  await supabase.from("platform_admins").delete().eq("id", adminId)

  await logAdminAction({
    adminId: caller.id,
    adminEmail: caller.email ?? "",
    action: "admin.remove",
    targetType: "admin",
    targetId: target.user_id,
    details: { email: target.email },
  })

  revalidatePath("/admin/settings")
  return { ok: true, message: `Removed ${target.email} from platform admins.` }
}
