"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"

export async function updateOrganizationAction(formData: FormData) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const orgId = String(formData.get("org_id") ?? "").trim()
  const name = String(formData.get("name") ?? "").trim()
  const billingEmail = String(formData.get("billing_email") ?? "").trim() || null

  if (!orgId || !name) {
    redirect("/settings/organization?error=Name is required")
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/settings/organization?error=Unauthorized")
  }

  const { error } = await supabase
    .from("organizations")
    .update({ name, billing_email: billingEmail })
    .eq("id", orgId)

  if (error) {
    redirect(`/settings/organization?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath("/", "layout")
  redirect("/settings/organization?success=Organization updated")
}
