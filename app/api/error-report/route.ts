// ALT-243: the route error boundary (app/error.tsx / app/global-error.tsx) is a client component
// hit during a hard crash — session/org context isn't reliably available there. It POSTs the raw
// crash facts here {digest, url, timestamp, message}; this route enriches with user/org SERVER-SIDE
// from the session (never trusting a client-supplied identity), emails the team via the existing
// Resend infra, and best-effort logs the report so repeats are queryable in the admin activity log.
// On any failure this still returns 200 { ok:false } (never a 500) so the client's mailto fallback
// can kick in without treating a network hiccup as an unhandled error.

import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { ErrorReportEmail } from "@/lib/email/templates/error-report"
import { logAdminAction, SYSTEM_ACTOR_ID } from "@/lib/admin/activity-log"

// Same convention as the vendor-health cron alert: an env-overridable ops distribution list,
// defaulting to the founders.
const OPS_RECIPIENTS = (process.env.OPS_ALERT_EMAILS ?? "bryan@alivelabs.io,chris@alivelabs.io")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

interface ErrorReportBody {
  digest?: string
  url?: string
  timestamp?: string
  message?: string
}

function isValidBody(body: unknown): body is ErrorReportBody & { url: string; timestamp: string } {
  if (!body || typeof body !== "object") return false
  const b = body as Record<string, unknown>
  return typeof b.url === "string" && b.url.length > 0 && typeof b.timestamp === "string" && b.timestamp.length > 0
}

/** Server-side-only enrichment: who hit this, and what org are they in. Never derived from the
 *  client body — session/org context is untrustworthy (or simply absent) during a hard crash. */
async function enrichFromSession(): Promise<{ userEmail?: string; orgName?: string }> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data } = await supabase.auth.getUser()
    const user = data?.user
    if (!user) return {}

    const admin = createAdminSupabaseClient()
    const { data: membership } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle()

    if (!membership) return { userEmail: user.email ?? undefined }

    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", membership.organization_id)
      .maybeSingle()

    return { userEmail: user.email ?? undefined, orgName: org?.name ?? undefined }
  } catch (err) {
    // Enrichment is best-effort — a failure here must never block the report itself.
    console.error("[error-report] session/org enrichment failed:", err)
    return {}
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 })
  }

  if (!isValidBody(body)) {
    return NextResponse.json(
      { ok: false, error: "url and timestamp are required." },
      { status: 400 }
    )
  }

  const { digest, url, timestamp, message } = body
  const { userEmail, orgName } = await enrichFromSession()

  const subject = digest
    ? `[Ticket] Error report — ref ${digest}`
    : `[Ticket] Error report`

  const emailResult = await sendEmail({
    to: OPS_RECIPIENTS,
    subject,
    react: ErrorReportEmail({ digest, url, timestamp, message, userEmail, orgName }),
    // clientFacing defaults to false -> internal alert, bypasses the CLIENT_EMAILS_ENABLED pause.
  })

  // Best-effort, queryable record for triage. Never blocks the response either way.
  await logAdminAction({
    adminId: SYSTEM_ACTOR_ID,
    adminEmail: userEmail ?? "unknown",
    action: "error_report.submitted",
    targetType: "error_report",
    targetId: digest ?? "unknown",
    actorType: "system",
    details: { digest, url, timestamp, message, orgName, emailSent: emailResult.ok },
  })

  if (!emailResult.ok) {
    // Not a 500 — a failed send is an expected, handled case. The client falls back to mailto.
    return NextResponse.json({ ok: false, error: emailResult.error ?? "Failed to send report." })
  }

  return NextResponse.json({ ok: true })
}
