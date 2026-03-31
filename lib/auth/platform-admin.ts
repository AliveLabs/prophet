import { redirect } from "next/navigation"
import { requireUser } from "./server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { User } from "@supabase/supabase-js"

export async function requirePlatformAdmin(): Promise<User> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from("platform_admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle()

  if (!data) redirect("/home")
  return user
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from("platform_admins")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()

  return !!data
}
