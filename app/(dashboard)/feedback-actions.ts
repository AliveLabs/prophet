"use server"

// ALT-371: persist a beta user's feedback, then best-effort ping ops by email. The row is the
// source of truth (queryable for the beta-learning loop); the email just surfaces it live.
//
// Written through the USER-scoped Supabase client so the beta_feedback RLS policies enforce
// "member of the org, writing as yourself". Identity (user, org) is resolved SERVER-SIDE — never
// trusted from the client. `beta_feedback` isn't in the generated DB types yet, so the insert
// uses the same loose-client cast the rest of the app uses for not-yet-regenerated tables.

import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { BetaFeedbackEmail } from "@/lib/email/templates/beta-feedback"
import { normalizeCategory, normalizeMessage, normalizePagePath } from "@/lib/feedback/feedback"
import { headers } from "next/headers"

const OPS_RECIPIENTS = (process.env.OPS_ALERT_EMAILS ?? "bryan@alivelabs.io,chris@alivelabs.io")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

type FeedbackInsertClient = {
  from: (t: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
  }
}

export async function submitBetaFeedback(input: {
  message: string
  category?: string | null
  /** The location the operator was viewing (context), if any. */
  locationId?: string | null
  /** The route they were on — captured automatically for in-context signal. */
  pagePath?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser()

  const message = normalizeMessage(input.message)
  if (!message) return { ok: false, error: "Add a note before sending." }
  const category = normalizeCategory(input.category)
  const pagePath = normalizePagePath(input.pagePath)

  const supabase = await createServerSupabaseClient()

  // Resolve the org SERVER-SIDE: from the viewed location if we have one, else the user's
  // membership. Never take an org id from the client.
  let organizationId: string | null = null
  let locationId: string | null = null
  if (input.locationId) {
    const { data: loc } = await supabase
      .from("locations")
      .select("id, organization_id")
      .eq("id", input.locationId)
      .maybeSingle()
    if (loc) {
      organizationId = loc.organization_id
      locationId = loc.id
    }
  }
  if (!organizationId) {
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle()
    organizationId = membership?.organization_id ?? null
  }
  if (!organizationId) return { ok: false, error: "We couldn't find your account. Try reloading." }

  let userAgent: string | null = null
  try {
    userAgent = (await headers()).get("user-agent")?.slice(0, 500) ?? null
  } catch {
    /* headers() unavailable in some contexts — non-fatal */
  }

  const db = supabase as unknown as FeedbackInsertClient
  const { error } = await db.from("beta_feedback").insert({
    organization_id: organizationId,
    location_id: locationId,
    user_id: user.id,
    category,
    message,
    page_path: pagePath,
    user_agent: userAgent,
  })
  if (error) {
    console.error("[beta-feedback] insert failed:", error.message)
    return { ok: false, error: "That didn't send. Please try again." }
  }

  // Best-effort ops ping — must never turn a saved-fine submission into a failure.
  try {
    const admin = createAdminSupabaseClient()
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle()
    await sendEmail({
      to: OPS_RECIPIENTS,
      subject: `[Ticket] Beta feedback${org?.name ? ` — ${org.name}` : ""}`,
      react: BetaFeedbackEmail({
        message,
        category: category ?? undefined,
        pagePath: pagePath ?? undefined,
        userEmail: user.email ?? undefined,
        orgName: org?.name ?? undefined,
      }),
    })
  } catch (err) {
    console.error("[beta-feedback] ops notify failed (feedback still saved):", err)
  }

  return { ok: true }
}
