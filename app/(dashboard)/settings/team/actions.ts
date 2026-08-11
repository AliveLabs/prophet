"use server"

// Customer-facing team management (ALT-457 phase 1): an owner or admin can invite people
// to their own org and remove them, from Settings → Team. Previously this only existed as a
// platform-admin action, so an operator had to ask us to add their own staff.
//
// Deliberately NO new table. A "pending invite" is just a membership row whose auth user
// has never signed in, which the roster reports from auth's last_sign_in_at. That keeps this
// migration-free; if invite expiry or resend-tracking is needed later, a table can be added
// without changing this contract.
//
// Phase 1 grants ORG-WIDE access. Per-location scoping is the next phase.

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/auth/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { sendEmail } from "@/lib/email/send"
import { WaitlistInvitation } from "@/lib/email/templates/waitlist-invitation"
import { ensureCanInviteTeamMember } from "@/lib/billing/limits"
import { shouldPointNewOwnerAtOrg } from "@/lib/onboarding/claim-current-org"
import {
  assessInviteRole,
  assessRemoval,
  canManageTeam,
  normalizeInviteEmail,
} from "@/lib/team/guards"

export interface TeamActionResult {
  ok: boolean
  message?: string
  error?: string
}

/** The caller's org + their role in it, resolved from the session (never from the client). */
async function resolveActor() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) return null

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) return null
  return { userId: user.id, organizationId, role: membership.role as string }
}

export async function inviteTeamMemberAction(formData: FormData): Promise<TeamActionResult> {
  const actor = await resolveActor()
  if (!actor) return { ok: false, error: "We couldn't confirm your account. Try signing in again." }

  const requestedRole = String(formData.get("role") ?? "member")
  const roleCheck = assessInviteRole(actor.role, requestedRole)
  if (!roleCheck.ok) return { ok: false, error: roleCheck.error }

  const email = normalizeInviteEmail(String(formData.get("email") ?? ""))
  if (!email) return { ok: false, error: "Enter a valid email address." }

  const fullName = String(formData.get("fullName") ?? "").trim() || undefined
  const admin = createAdminSupabaseClient()

  // Tier gate, enforced server-side so a disabled button can't be bypassed.
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, subscription_tier, trial_ends_at, payment_state, deleted_at")
    .eq("id", actor.organizationId)
    .maybeSingle()
  if (!org) return { ok: false, error: "Organization not found." }
  // Soft-deleted org ⇒ no new members. This action GRANTS access: it creates an auth user, an
  // organization_members row, and (via shouldPointNewOwnerAtOrg below) may set the invitee's
  // current_organization_id. resolveActor() above resolves the org inline and server actions
  // never pass through the (dashboard) layout's deleted_at gate, so this is the gate.
  if (org.deleted_at) {
    return { ok: false, error: "This organization is no longer active." }
  }

  try {
    ensureCanInviteTeamMember({
      subscription_tier: org.subscription_tier,
      trial_ends_at: org.trial_ends_at,
      payment_state: org.payment_state,
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Your plan doesn't include team members." }
  }

  // Find or create the auth user. listUsers is paginated; match on the normalized email.
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const existing = authList?.users?.find((u) => u.email?.toLowerCase() === email)

  let userId: string
  if (existing) {
    userId = existing.id
    const { data: alreadyMember } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", actor.organizationId)
      .eq("user_id", userId)
      .maybeSingle()
    if (alreadyMember) {
      return { ok: false, error: `${email} is already on this account.` }
    }
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    })
    if (createErr || !created.user) {
      return { ok: false, error: createErr?.message ?? "Couldn't create that account." }
    }
    userId = created.user.id
  }

  const { error: memberErr } = await admin
    .from("organization_members")
    .insert({ organization_id: actor.organizationId, user_id: userId, role: requestedRole })
  if (memberErr) return { ok: false, error: memberErr.message }

  // Point them at this org. Without a current_organization_id, /auth/callback and
  // resolveOperator() both send them to /onboarding — an invited teammate would be asked to
  // set up a restaurant instead of joining the one that invited them. Only set it when they
  // have nowhere else to be, so inviting an existing operator can't hijack their dashboard.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id, current_organization_id")
    .eq("id", userId)
    .maybeSingle()

  const profileRow: {
    id: string
    email: string
    full_name?: string
    current_organization_id?: string
  } = { id: userId, email }
  if (fullName && !existingProfile) profileRow.full_name = fullName
  if (shouldPointNewOwnerAtOrg(existingProfile?.current_organization_id)) {
    profileRow.current_organization_id = actor.organizationId
  }
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert(profileRow, { onConflict: "id" })
  if (profileErr) {
    console.error("[inviteTeamMember] profile upsert failed:", profileErr.message)
  }

  // Magic link so they can get in without inventing a password.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  })
  const magicLinkUrl = linkData?.properties?.action_link ?? `${appUrl}/login`

  const emailResult = await sendEmail({
    to: email,
    subject: `You've been added to ${org.name} on Ticket`,
    react: WaitlistInvitation({ name: fullName, magicLinkUrl }),
    clientFacing: true,
    // Billing-adjacent onboarding mail: someone is waiting on this link right now, so it
    // must not sit behind the marketing-email pause.
    overrideClientEmailPause: true,
  })

  revalidatePath("/settings/team")

  if (!emailResult.ok) {
    return {
      ok: true,
      message: `Added ${email}, but the invite email didn't send. They can sign in with their email from the login page.`,
    }
  }
  return { ok: true, message: `Invited ${email}.` }
}

export async function removeTeamMemberAction(targetUserId: string): Promise<TeamActionResult> {
  const actor = await resolveActor()
  if (!actor) return { ok: false, error: "We couldn't confirm your account. Try signing in again." }
  if (!canManageTeam(actor.role)) {
    return { ok: false, error: "Only an owner or admin can remove people." }
  }

  const admin = createAdminSupabaseClient()

  const { data: members } = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", actor.organizationId)

  const target = members?.find((m) => m.user_id === targetUserId)
  if (!target) return { ok: false, error: "That person isn't on this account." }

  const check = assessRemoval({
    targetUserId,
    targetRole: target.role as string,
    actorUserId: actor.userId,
    actorRole: actor.role,
    ownerCount: (members ?? []).filter((m) => m.role === "owner").length,
  })
  if (!check.ok) return { ok: false, error: check.error }

  const { error } = await admin
    .from("organization_members")
    .delete()
    .eq("organization_id", actor.organizationId)
    .eq("user_id", targetUserId)
  if (error) return { ok: false, error: error.message }

  // Leave the auth user and their profile alone: they may belong to other orgs, and this is
  // a "remove from this account" action, not an account deletion.
  revalidatePath("/settings/team")
  return { ok: true, message: "Removed from this account." }
}
