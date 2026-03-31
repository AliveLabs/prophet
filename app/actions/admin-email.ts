"use server"

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { logAdminAction } from "@/lib/admin/activity-log"
import { sendEmail } from "@/lib/email/send"
import { AdminCustomEmail } from "@/lib/email/templates/admin-custom"

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

export async function sendCustomEmail(
  to: string,
  subject: string,
  body: string
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()

  if (!to || !subject || !body) {
    return { ok: false, error: "To, subject, and body are required." }
  }

  const result = await sendEmail({
    to,
    subject,
    react: AdminCustomEmail({ subject, body }),
  })

  if (!result.ok) {
    return { ok: false, error: result.error ?? "Failed to send email." }
  }

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "email.send_custom",
    targetType: "user",
    targetId: to,
    details: { subject },
  })

  return { ok: true, message: `Email sent to ${to}.` }
}

export async function broadcastEmail(
  subject: string,
  body: string,
  filter?: { tier?: string; trialStatus?: "active" | "expired" }
): Promise<ActionResult> {
  const admin = await requirePlatformAdmin()
  const supabase = createAdminSupabaseClient()

  if (!subject || !body) {
    return { ok: false, error: "Subject and body are required." }
  }

  const { data: authData } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  let targetEmails = (authData?.users ?? [])
    .map((u) => u.email)
    .filter((e): e is string => !!e)

  if (filter?.tier || filter?.trialStatus) {
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id, organization_id")

    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, subscription_tier, trial_ends_at")

    if (members && orgs) {
      const orgMap = new Map(orgs.map((o) => [o.id, o]))
      const now = new Date()

      const validUserIds = new Set<string>()
      for (const m of members) {
        const org = orgMap.get(m.organization_id)
        if (!org) continue

        let matches = true
        if (filter.tier && org.subscription_tier !== filter.tier) matches = false
        if (filter.trialStatus === "active") {
          if (
            org.subscription_tier !== "free" ||
            !org.trial_ends_at ||
            new Date(org.trial_ends_at) <= now
          )
            matches = false
        }
        if (filter.trialStatus === "expired") {
          if (
            org.subscription_tier !== "free" ||
            !org.trial_ends_at ||
            new Date(org.trial_ends_at) > now
          )
            matches = false
        }

        if (matches) validUserIds.add(m.user_id)
      }

      const users = authData?.users ?? []
      targetEmails = users
        .filter((u) => validUserIds.has(u.id))
        .map((u) => u.email)
        .filter((e): e is string => !!e)
    }
  }

  if (targetEmails.length === 0) {
    return { ok: false, error: "No recipients match the filter criteria." }
  }

  const batchSize = 50
  let sentCount = 0
  for (let i = 0; i < targetEmails.length; i += batchSize) {
    const batch = targetEmails.slice(i, i + batchSize)
    const promises = batch.map((email) =>
      sendEmail({
        to: email,
        subject,
        react: AdminCustomEmail({ subject, body }),
      })
    )
    const results = await Promise.allSettled(promises)
    sentCount += results.filter(
      (r) => r.status === "fulfilled" && r.value.ok
    ).length
  }

  await logAdminAction({
    adminId: admin.id,
    adminEmail: admin.email ?? "",
    action: "email.broadcast",
    targetType: "broadcast",
    targetId: "all",
    details: { subject, recipientCount: targetEmails.length, sentCount, filter },
  })

  return {
    ok: true,
    message: `Broadcast sent to ${sentCount}/${targetEmails.length} recipients.`,
  }
}
