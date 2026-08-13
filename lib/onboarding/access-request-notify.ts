// Notification I/O shared by the signup-collision actions (app/onboarding/actions.ts)
// and the daily access-requests cron (app/api/cron/access-requests). Kept out of the
// "use server" actions file so the cron can import it without dragging server actions in.

import type { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { InternalAlert } from "@/lib/email/templates/internal-alert"
import { postSlackAlert } from "@/lib/ops/slack"

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

/**
 * Who gets the "someone wants to join" email for an org: owners first; admins only when
 * the org has no owner with an email on file. Returns [] when nobody is reachable, which
 * callers treat as an immediate ops signal (that org is exactly the abandoned-owner case).
 */
export async function loadOrgManagerRecipients(
  admin: AdminClient,
  orgId: string
): Promise<Array<{ email: string; name: string }>> {
  const { data: managers } = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", orgId)
    .in("role", ["owner", "admin"])
  const rows = managers ?? []
  const owners = rows.filter((m) => m.role === "owner")

  const resolve = async (ids: string[]) => {
    if (ids.length === 0) return []
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", ids)
    return (profiles ?? [])
      .filter((p): p is typeof p & { email: string } => Boolean(p.email))
      .map((p) => ({ email: p.email, name: p.full_name?.trim() || p.email.split("@")[0] }))
  }

  const ownerRecipients = await resolve(owners.map((m) => m.user_id))
  if (ownerRecipients.length > 0) return ownerRecipients
  return resolve(rows.filter((m) => m.role === "admin").map((m) => m.user_id))
}

/**
 * Internal ops notification: Slack (env-gated, best-effort) + the ops inbox, mirroring the
 * vendor-health cron's both-channels pattern for anything a human must act on. Never throws.
 */
export async function notifyOps(subject: string, lines: string[]): Promise<void> {
  try {
    await postSlackAlert([subject, ...lines].join("\n"))
  } catch (err) {
    console.error("[access-request] slack alert failed:", err)
  }
  try {
    const recipients = (process.env.OPS_ALERT_EMAILS ?? "bryan@alivelabs.io,chris@alivelabs.io")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    await sendEmail({
      to: recipients,
      subject: `[Ticket] ${subject}`,
      react: InternalAlert({ heading: subject, lines }),
      // clientFacing defaults to false -> internal, bypasses the CLIENT_EMAILS_ENABLED pause.
    })
  } catch (err) {
    console.error("[access-request] ops email failed:", err)
  }
}
