"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { getImpersonation } from "@/lib/auth/impersonation"
import { requestBillingEmailChange } from "@/lib/billing/email-verification"

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
  const submittedBillingEmail = String(formData.get("billing_email") ?? "").trim() || null

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

  const { data: org } = await supabase
    .from("organizations")
    .select("billing_email")
    .eq("id", orgId)
    .maybeSingle()

  const currentBillingEmail = org?.billing_email ?? null
  const billingEmailChanged = submittedBillingEmail !== currentBillingEmail

  // ALT-227: `billing_email` is only ever written here when it's being CLEARED
  // (no redirect-of-correspondence risk in removing a contact) or left as-is.
  // A change to a NEW address goes through requestBillingEmailChange below —
  // it lands in `pending_billing_email` and only becomes `billing_email` once
  // that address is verified.
  const { error } = await supabase
    .from("organizations")
    .update({
      display_name: displayName,
      ...(billingEmailChanged && !submittedBillingEmail ? { billing_email: null } : {}),
    })
    .eq("id", orgId)

  if (error) {
    redirect(`/settings/organization?error=${encodeURIComponent(error.message)}`)
  }

  let successMessage = "Organization updated"
  if (billingEmailChanged && submittedBillingEmail) {
    const result = await requestBillingEmailChange(orgId, submittedBillingEmail, currentBillingEmail)
    successMessage = result.ok
      ? `Organization updated. Confirm ${submittedBillingEmail} — we sent a verification link, it won't take effect until then.`
      : `Organization updated, but ${result.error}`
  }

  revalidatePath("/", "layout")
  redirect(`/settings/organization?success=${encodeURIComponent(successMessage)}`)
}

export async function resendBillingEmailVerificationAction(formData: FormData) {
  if (await getImpersonation()) {
    redirect("/settings/organization?error=Disabled while viewing as a user (read-only)")
  }
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const orgId = String(formData.get("org_id") ?? "").trim()
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

  const { data: org } = await supabase
    .from("organizations")
    .select("billing_email, pending_billing_email")
    .eq("id", orgId)
    .maybeSingle()

  if (!org?.pending_billing_email) {
    redirect("/settings/organization?error=No pending billing email to verify")
  }

  const result = await requestBillingEmailChange(orgId, org.pending_billing_email, org.billing_email ?? null)
  redirect(
    result.ok
      ? `/settings/organization?success=${encodeURIComponent(`Verification email re-sent to ${org.pending_billing_email}`)}`
      : `/settings/organization?error=${encodeURIComponent(result.error)}`,
  )
}
