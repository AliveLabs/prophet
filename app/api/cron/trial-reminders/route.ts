import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  sendEmail,
  FROM_ADDRESS_TICKET,
  FROM_ADDRESS_NEAT,
} from "@/lib/email/send"
import { TrialDay10 } from "@/lib/email/templates/trial-day-10"
import { TrialDay13 } from "@/lib/email/templates/trial-day-13"
import { asSubscriptionTier, getTierDisplayName } from "@/lib/billing/tiers"
import { isValidIndustryType, type IndustryType } from "@/lib/verticals"

export const maxDuration = 60

// Daily cron. Sends Day 10 ("T-4") and Day 13 ("T-1") reminders for
// mid-tier Stripe trials, driven by (trial_ends_at - today). Dedupes by
// inserting into public.trial_reminder_sends BEFORE sending so a failed send
// that retries later from the idempotency cron won't double-email.
//
// Day 10 -> trial_ends_at is ~4 days out.  Day 13 -> ~1 day out.
// reminder_day stored as 10 or 13 for readability (matches brief language).

type ReminderDay = 10 | 13

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()
  const now = new Date()
  const sent: string[] = []
  const skipped: string[] = []
  const errors: string[] = []

  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, name, trial_ends_at, industry_type, subscription_tier, payment_state")
    .eq("payment_state", "trialing")
    .not("trial_ends_at", "is", null)

  if (error) {
    console.error("trial-reminders query failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ sent: 0, skipped: [], errors: [] })
  }

  for (const org of orgs) {
    if (!org.trial_ends_at) continue
    const trialEnd = new Date(org.trial_ends_at)
    const diffMs = trialEnd.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

    let reminderDay: ReminderDay | null = null
    if (diffDays === 4) reminderDay = 10
    else if (diffDays === 1) reminderDay = 13
    else continue

    const industryType: IndustryType = isValidIndustryType(org.industry_type)
      ? org.industry_type
      : "restaurant"

    const { error: insertError } = await admin
      .from("trial_reminder_sends")
      .insert({
        organization_id: org.id,
        reminder_day: reminderDay,
      })

    if (insertError) {
      if (insertError.code === "23505") {
        skipped.push(`${org.id}:day${reminderDay}:already_sent`)
        continue
      }
      errors.push(`${org.id}:day${reminderDay}:${insertError.message}`)
      continue
    }

    const { data: owners } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", org.id)
      .in("role", ["owner", "admin"])

    if (!owners || owners.length === 0) continue

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const portalUrl = `${appUrl}/settings/billing`
    const brand = industryType === "liquor_store" ? "Neat" : "Ticket"
    const fromAddress =
      industryType === "liquor_store" ? FROM_ADDRESS_NEAT : FROM_ADDRESS_TICKET
    const tierDisplayName = getTierDisplayName(
      asSubscriptionTier(org.subscription_tier),
      industryType
    )

    for (const owner of owners) {
      const { data: profile } = await admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", owner.user_id)
        .maybeSingle()
      if (!profile?.email) continue

      const userName = profile.full_name ?? profile.email.split("@")[0]

      try {
        const react =
          reminderDay === 10
            ? TrialDay10({
                brand,
                userName,
                tierDisplayName,
                portalUrl,
                cancelUrl: portalUrl,
              })
            : TrialDay13({
                brand,
                userName,
                tierDisplayName,
                portalUrl,
                cancelUrl: portalUrl,
              })

        const subject =
          reminderDay === 10
            ? `${userName}, 4 days left in your ${brand} trial`
            : `${userName}, tomorrow your ${brand} trial ends`

        await sendEmail({
          from: fromAddress,
          to: profile.email,
          subject,
          react,
          clientFacing: true,
          overrideClientEmailPause: false,
        })

        sent.push(`day${reminderDay}:${profile.email}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown"
        errors.push(`day${reminderDay}:${profile.email}:${msg}`)
      }
    }
  }

  return NextResponse.json({
    sent: sent.length,
    details: sent,
    skipped,
    errors,
  })
}
