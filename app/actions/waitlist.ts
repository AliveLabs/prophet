"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { withAdminAction } from "@/lib/auth/with-admin-action"
import { logAdminAction, logCriticalAction } from "@/lib/admin/activity-log"
import { sendEmail } from "@/lib/email/send"
import { WaitlistInvitation } from "@/lib/email/templates/waitlist-invitation"
import { WaitlistDecline } from "@/lib/email/templates/waitlist-decline"
import { createOrgWithOwner } from "@/lib/admin/org-factory"
import { cascadeDeleteOrganization } from "@/lib/admin/cascade-cleanup"

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

export const approveWaitlistSignup = withAdminAction(
  "waitlist.manage",
  async (ctx, signupId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: signup, error: fetchError } = await supabase
      .from("waitlist_signups")
      .select("*")
      .eq("id", signupId)
      .single()

    if (fetchError || !signup) {
      return { ok: false, error: "Signup not found." }
    }

    if (signup.status !== "pending") {
      return { ok: false, error: `Signup is already ${signup.status}.` }
    }

    const fullName =
      [signup.first_name, signup.last_name].filter(Boolean).join(" ") || null

    let userId: string

    const { data: existingUsers } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    const existingUser = existingUsers?.users?.find(
      (u) => u.email === signup.email
    )

    if (existingUser) {
      userId = existingUser.id
    } else {
      const { data: newUser, error: createError } =
        await supabase.auth.admin.createUser({
          email: signup.email,
          email_confirm: true,
          user_metadata: fullName ? { full_name: fullName } : undefined,
        })

      if (createError || !newUser.user) {
        return {
          ok: false,
          error: createError?.message ?? "Failed to create user account.",
        }
      }
      userId = newUser.user.id
    }

    const orgName = fullName
      ? `${fullName}'s Organization`
      : `${signup.email.split("@")[0]}'s Organization`

    // Dedupe: if this signup already has an org (e.g. it was previously approved,
    // reverted to pending, then re-approved), reuse it instead of creating a second
    // org for the same signup. (Fixes the duplicate-org-on-reapprove bug.)
    let orgId: string
    const { data: existingOrg } = await supabase
      .from("organizations")
      .select("id")
      .eq("waitlist_signup_id", signup.id)
      .maybeSingle()

    if (existingOrg) {
      orgId = existingOrg.id
      const { data: existingMember } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle()
      if (!existingMember) {
        await supabase.from("organization_members").insert({
          organization_id: orgId,
          user_id: userId,
          role: "owner",
        })
      }
    } else {
      try {
        const created = await createOrgWithOwner(supabase, {
          ownerUserId: userId,
          orgName,
          billingEmail: signup.email,
          orgKind: "real",
          waitlistSignupId: signup.id,
        })
        orgId = created.orgId
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Failed to create organization.",
        }
      }
    }

    await supabase
      .from("waitlist_signups")
      .update({
        status: "approved",
        reviewed_by: ctx.adminId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", signupId)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    const redirectTo = `${appUrl}/auth/callback`

    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: signup.email,
      options: { redirectTo },
    })

    const magicLinkUrl =
      linkData?.properties?.action_link ?? `${appUrl}/login`

    const emailResult = await sendEmail({
      to: signup.email,
      subject: "You're in! Your Ticket dashboard is ready",
      react: WaitlistInvitation({
        name: fullName ?? undefined,
        magicLinkUrl,
      }),
      clientFacing: true,
      overrideClientEmailPause: true,
    })

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "waitlist.approve",
      targetType: "waitlist",
      targetId: signupId,
      details: { email: signup.email },
    })

    revalidatePath("/admin/waitlist")

    if (!emailResult.ok) {
      return {
        ok: true,
        message: `Approved ${signup.email} but invitation email failed to send. Use "Resend Invite" to retry.`,
      }
    }

    return { ok: true, message: `Approved ${signup.email} — invitation email sent.` }
  }
)

// Reverse an approval: signup back to 'pending', delete the org the approval created
// (via the canonical cascade), and delete the auto-created auth user IF it now owns
// no orgs (so it can't self-serve back in). Productizes the 2026-06-22 hand-fix.
export const unapproveWaitlistSignup = withAdminAction(
  "waitlist.manage",
  async (ctx, signupId: string, reason: string = ""): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: signup } = await supabase
      .from("waitlist_signups")
      .select("*")
      .eq("id", signupId)
      .single()
    if (!signup) return { ok: false, error: "Signup not found." }
    if (signup.status !== "approved") {
      return { ok: false, error: `Signup is ${signup.status}, not approved — nothing to revert.` }
    }

    // Destructive (deletes the approval's org + possibly the auto-created user). Record
    // intent + reason before any delete ("no log ⇒ no action").
    const intent = await logCriticalAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "waitlist.unapprove",
      targetType: "waitlist",
      targetId: signupId,
      reason,
      before: { email: signup.email, status: signup.status },
      details: { phase: "intent" },
    })
    if (!intent.ok) return intent

    // Delete the org created from this signup (if any).
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("waitlist_signup_id", signupId)
      .maybeSingle()
    if (org) {
      try {
        await cascadeDeleteOrganization(supabase, org.id)
      } catch (e) {
        return {
          ok: false,
          error: `Failed to remove the org created on approval: ${e instanceof Error ? e.message : "unknown error"}`,
        }
      }
    }

    // Delete the auto-created auth user — but only if it no longer owns any org (i.e. it
    // was created for this signup, not a real multi-org user). Closes the access vector.
    let userDeleted = false
    const email = (signup.email ?? "").toLowerCase()
    if (email) {
      const { data: users } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const u = users?.users?.find((x) => (x.email ?? "").toLowerCase() === email)
      if (u) {
        const { count } = await supabase
          .from("organization_members")
          .select("*", { count: "exact", head: true })
          .eq("user_id", u.id)
        if ((count ?? 0) === 0) {
          await supabase.from("profiles").update({ current_organization_id: null }).eq("id", u.id)
          const { error: delErr } = await supabase.auth.admin.deleteUser(u.id)
          if (!delErr) userDeleted = true
        }
      }
    }

    await supabase
      .from("waitlist_signups")
      .update({ status: "pending", reviewed_by: null, reviewed_at: null })
      .eq("id", signupId)

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "waitlist.unapprove",
      targetType: "waitlist",
      targetId: signupId,
      reason,
      details: { phase: "result", email: signup.email, orgDeleted: Boolean(org), userDeleted },
    })

    revalidatePath("/admin/waitlist")
    return {
      ok: true,
      message: `Reverted ${signup.email} to pending${org ? " · org removed" : ""}${userDeleted ? " · account removed" : ""}.`,
    }
  }
)

export const declineWaitlistSignup = withAdminAction(
  "waitlist.manage",
  async (ctx, signupId: string, adminNotes?: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: signup, error: fetchError } = await supabase
      .from("waitlist_signups")
      .select("*")
      .eq("id", signupId)
      .single()

    if (fetchError || !signup) {
      return { ok: false, error: "Signup not found." }
    }

    if (signup.status !== "pending") {
      return { ok: false, error: `Signup is already ${signup.status}.` }
    }

    await supabase
      .from("waitlist_signups")
      .update({
        status: "declined",
        reviewed_by: ctx.adminId,
        reviewed_at: new Date().toISOString(),
        admin_notes: adminNotes || null,
      })
      .eq("id", signupId)

    const fullName =
      [signup.first_name, signup.last_name].filter(Boolean).join(" ") || null

    const emailResult = await sendEmail({
      to: signup.email,
      subject: "Update on your Ticket waitlist request",
      react: WaitlistDecline({
        name: fullName ?? undefined,
      }),
      clientFacing: true,
      overrideClientEmailPause: true,
    })

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "waitlist.decline",
      targetType: "waitlist",
      targetId: signupId,
      details: { email: signup.email, adminNotes },
    })

    revalidatePath("/admin/waitlist")

    if (!emailResult.ok) {
      return { ok: true, message: `Declined ${signup.email} but notification email failed to send.` }
    }

    return { ok: true, message: `Declined ${signup.email} — notification email sent.` }
  }
)

export const resendWaitlistInvite = withAdminAction(
  "waitlist.manage",
  async (ctx, signupId: string): Promise<ActionResult> => {
    const supabase = createAdminSupabaseClient()

    const { data: signup, error: fetchError } = await supabase
      .from("waitlist_signups")
      .select("*")
      .eq("id", signupId)
      .single()

    if (fetchError || !signup) {
      return { ok: false, error: "Signup not found." }
    }

    if (signup.status !== "approved") {
      return { ok: false, error: "Can only resend invites for approved signups." }
    }

    const { data: existingUsers } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    const existingUser = existingUsers?.users?.find(
      (u) => u.email === signup.email
    )

    if (!existingUser) {
      return { ok: false, error: "No auth user found for this email. The user may have been deleted." }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: signup.email,
      options: { redirectTo: `${appUrl}/auth/callback` },
    })

    const magicLinkUrl =
      linkData?.properties?.action_link ?? `${appUrl}/login`

    const fullName =
      [signup.first_name, signup.last_name].filter(Boolean).join(" ") || null

    const emailResult = await sendEmail({
      to: signup.email,
      subject: "You're in! Your Ticket dashboard is ready",
      react: WaitlistInvitation({
        name: fullName ?? undefined,
        magicLinkUrl,
      }),
      clientFacing: true,
      overrideClientEmailPause: true,
    })

    await logAdminAction({
      adminId: ctx.adminId,
      adminEmail: ctx.adminEmail,
      action: "waitlist.resend_invite",
      targetType: "waitlist",
      targetId: signupId,
      details: { email: signup.email },
    })

    revalidatePath("/admin/waitlist")

    if (!emailResult.ok) {
      return { ok: false, error: `Failed to send invitation email to ${signup.email}.` }
    }

    return { ok: true, message: `Invitation email resent to ${signup.email}.` }
  }
)

// Batch helpers delegate to the per-item actions above, so each item passes through the
// same capability gate (a denial surfaces as that item's { ok:false, error }).
export async function batchApproveWaitlistSignups(
  signupIds: string[]
): Promise<{ results: Array<{ id: string } & ActionResult> }> {
  const results: Array<{ id: string } & ActionResult> = []

  for (const id of signupIds) {
    const result = await approveWaitlistSignup(id)
    results.push({ id, ...result })
  }

  return { results }
}

export async function batchDeclineWaitlistSignups(
  signupIds: string[],
  adminNotes?: string
): Promise<{ results: Array<{ id: string } & ActionResult> }> {
  const results: Array<{ id: string } & ActionResult> = []

  for (const id of signupIds) {
    const result = await declineWaitlistSignup(id, adminNotes)
    results.push({ id, ...result })
  }

  return { results }
}
