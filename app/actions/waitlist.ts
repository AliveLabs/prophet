"use server"

import { revalidatePath } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { logAdminAction } from "@/lib/admin/activity-log"
import { sendEmail } from "@/lib/email/send"
import { WaitlistInvitation } from "@/lib/email/templates/waitlist-invitation"
import { WaitlistDecline } from "@/lib/email/templates/waitlist-decline"
import { TRIAL_DURATION_DAYS } from "@/lib/billing/trial"

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

export async function approveWaitlistSignup(
  signupId: string
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
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

  const baseSlug = slugify(orgName)
  let orgId: string | null = null
  let slugAttempt = baseSlug || "org"

  for (let attempt = 0; attempt < 5; attempt++) {
    const now = new Date()
    const trialEnd = new Date(
      now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000
    )

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .insert({
        name: orgName,
        slug: slugAttempt,
        billing_email: signup.email,
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
        waitlist_signup_id: signup.id,
      })
      .select("id")
      .single()

    if (!orgError && org) {
      orgId = org.id
      break
    }

    if (orgError?.code === "23505") {
      slugAttempt = `${baseSlug}-${attempt + 2}`
      continue
    }

    return { ok: false, error: orgError?.message ?? "Failed to create organization." }
  }

  if (!orgId) {
    return { ok: false, error: "Could not generate a unique organization slug." }
  }

  await supabase.from("organization_members").insert({
    organization_id: orgId,
    user_id: userId,
    role: "owner",
  })

  await supabase
    .from("waitlist_signups")
    .update({
      status: "approved",
      reviewed_by: admin.id,
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
    subject: "You're in! Your Vatic dashboard is ready",
    react: WaitlistInvitation({
      name: fullName ?? undefined,
      magicLinkUrl,
    }),
  })

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
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

export async function declineWaitlistSignup(
  signupId: string,
  adminNotes?: string
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
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
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      admin_notes: adminNotes || null,
    })
    .eq("id", signupId)

  const fullName =
    [signup.first_name, signup.last_name].filter(Boolean).join(" ") || null

  const emailResult = await sendEmail({
    to: signup.email,
    subject: "Update on your Vatic waitlist request",
    react: WaitlistDecline({
      name: fullName ?? undefined,
    }),
  })

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
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

export async function resendWaitlistInvite(
  signupId: string
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
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
    subject: "You're in! Your Vatic dashboard is ready",
    react: WaitlistInvitation({
      name: fullName ?? undefined,
      magicLinkUrl,
    }),
  })

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
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
