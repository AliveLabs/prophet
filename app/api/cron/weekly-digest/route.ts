// ---------------------------------------------------------------------------
// GET /api/cron/weekly-digest (Mondays, after the brief precompute) — the highlights
// email that drives operators back to their brief. Per location: active access only,
// respects locations.settings.communications.weekly_digest, sends the latest brief's
// headline + top plays to every org member with an email. Auth: Bearer CRON_SECRET.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isTrialActive } from "@/lib/billing/trial"
import { getBrief } from "@/lib/insights/daily-brief"
import { sendEmail } from "@/lib/email/send"
import { WeeklyDigest } from "@/lib/email/templates/weekly-digest"
import { stripAccents } from "@/lib/text/accents"

export const maxDuration = 300

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.getticket.ai"

  const { data: locations, error } = await admin
    .from("locations")
    .select("id, name, organization_id, settings")
    .order("created_at", { ascending: true })
  if (error || !locations) {
    return Response.json({ error: "Failed to list locations", details: error?.message }, { status: 500 })
  }

  const orgIds = [...new Set(locations.map((l) => l.organization_id))]
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, subscription_tier, trial_ends_at, payment_state")
    .in("id", orgIds)
    .is("deleted_at", null)
  const orgById = new Map((orgs ?? []).map((o) => [o.id, o]))

  const results: Array<Record<string, unknown>> = []
  for (const loc of locations) {
    const org = orgById.get(loc.organization_id)
    if (!org || !isTrialActive(org)) {
      results.push({ locationId: loc.id, sent: 0, skipped: "no active access" })
      continue
    }
    const comms = ((loc.settings as Record<string, unknown> | null)?.communications ?? {}) as Record<string, boolean>
    if (comms.weekly_digest === false) {
      results.push({ locationId: loc.id, sent: 0, skipped: "digest off" })
      continue
    }

    const brief = await getBrief(loc.id)
    if (!brief) {
      results.push({ locationId: loc.id, sent: 0, skipped: "no brief yet" })
      continue
    }

    const { data: members } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", loc.organization_id)
    const userIds = (members ?? []).map((m) => m.user_id)
    const { data: profiles } = userIds.length
      ? await admin.from("profiles").select("email").in("id", userIds)
      : { data: [] as Array<{ email: string | null }> }
    const emails = [...new Set((profiles ?? []).map((p) => p.email).filter((e): e is string => !!e))]
    if (emails.length === 0) {
      results.push({ locationId: loc.id, sent: 0, skipped: "no member emails" })
      continue
    }

    const res = await sendEmail({
      to: emails,
      subject: `This week at ${loc.name ?? "your restaurant"}: ${stripAccents(brief.headline)}`,
      react: WeeklyDigest({
        locationName: loc.name ?? "your restaurant",
        headline: stripAccents(brief.headline),
        deck: brief.deck,
        plays: brief.plays.slice(0, 3).map((p) => ({ title: p.title, kind: p.kind })),
        briefUrl: `${appUrl}/home`,
      }),
      clientFacing: true,
    })
    results.push({ locationId: loc.id, sent: res.ok ? emails.length : 0, ...(res.ok ? {} : { error: res.error }) })
  }

  console.log(`[digest] ${results.filter((r) => (r.sent as number) > 0).length}/${results.length} locations emailed`)
  return Response.json({ locations: results.length, results })
}
