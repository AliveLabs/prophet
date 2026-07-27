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
import { hasCardOnFile, resolveReminderDay } from "@/lib/billing/trial-reminders"

export const maxDuration = 60

// Daily cron. Sends Day 10 ("T-4") and Day 13 ("T-1") trial reminders, driven by
// (trial_ends_at - today). Dedupes by inserting into public.trial_reminder_sends BEFORE
// sending so a failed send that retries later from the idempotency cron won't double-email.
//
// Covers BOTH trial kinds — card-backed Stripe trials (payment_state='trialing') and
// card-less clock trials from "skip for now" at onboarding (payment_state null). The
// card-less case used to be excluded by the query, so those orgs hit day 14 with no
// warning at all. Eligibility + the demo/test exclusion live in lib/billing/trial-reminders.

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  // Require the secret to be set AND match — a missing CRON_SECRET must FAIL CLOSED, not open the
  // endpoint (matches the worker/build-brief cron guard). `if (cronSecret && ...)` let it through.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()
  const now = new Date()
  const sent: string[] = []
  const skipped: string[] = []
  const errors: string[] = []

  // Card-backed trials AND card-less clock trials. `payment_state.is.null` also matches
  // internal/demo orgs with far-future clocks; resolveReminderDay() filters those out on
  // org_kind and on the T-4 / T-1 day window.
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, name, trial_ends_at, industry_type, subscription_tier, payment_state, org_kind")
    .or("payment_state.eq.trialing,payment_state.is.null")
    .not("trial_ends_at", "is", null)
    .is("deleted_at", null)

  if (error) {
    console.error("trial-reminders query failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ sent: 0, skipped: [], errors: [] })
  }

  for (const org of orgs) {
    const reminderDay = resolveReminderDay(org, now)
    if (reminderDay === null) continue
    // Card-less trials convert by ADDING a card, not by an automatic charge, so the copy
    // has to differ — promising a charge to someone with no card on file would be a lie.
    const carded = hasCardOnFile(org)

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
                hasCard: carded,
              })
            : TrialDay13({
                brand,
                userName,
                tierDisplayName,
                portalUrl,
                cancelUrl: portalUrl,
                hasCard: carded,
              })

        const subject =
          reminderDay === 10
            ? `${userName}, 4 days left in your ${brand} trial`
            : carded
              ? `${userName}, tomorrow your ${brand} trial ends`
              : `${userName}, add a card to keep ${brand} running`

        // Billing-critical, not marketing: either a card on file WILL be charged at
        // trial end, or the trial is about to lapse and end their briefs — and the
        // checkout copy promises day 10 + day 13 reminders either way. Like the
        // payment-failed email, this must bypass the CLIENT_EMAILS_ENABLED pause.
        await sendEmail({
          from: fromAddress,
          to: profile.email,
          subject,
          react,
          clientFacing: true,
          overrideClientEmailPause: true,
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
