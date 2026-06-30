"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { getImpersonation } from "@/lib/auth/impersonation"

export async function updateOrganizationAction(formData: FormData) {
  if (await getImpersonation()) {
    redirect("/settings/organization?error=Disabled while viewing as a user (read-only)")
  }
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const orgId = String(formData.get("org_id") ?? "").trim()
  // ALT-226: the legal `name` is IMMUTABLE here — the operator edits an optional, friendlier
  // Display name (blank ⇒ NULL ⇒ fall back to the legal name everywhere it's shown).
  const displayName = String(formData.get("display_name") ?? "").trim() || null
  const billingEmail = String(formData.get("billing_email") ?? "").trim() || null

  if (!orgId) {
    redirect("/settings/organization?error=Missing organization")
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
    .update({ display_name: displayName, billing_email: billingEmail })
    .eq("id", orgId)

  if (error) {
    redirect(`/settings/organization?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath("/", "layout")
  redirect("/settings/organization?success=Organization updated")
}
