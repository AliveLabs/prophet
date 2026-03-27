"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"

export async function signOutAction() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  redirect("/login")
}

export async function switchOrganizationAction(orgId: string) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) {
    throw new Error("You are not a member of this organization.")
  }

  const { error } = await supabase
    .from("profiles")
    .update({ current_organization_id: orgId })
    .eq("id", user.id)

  if (error) {
    throw new Error("Failed to switch organization.")
  }

  revalidatePath("/", "layout")
  redirect("/home")
}
