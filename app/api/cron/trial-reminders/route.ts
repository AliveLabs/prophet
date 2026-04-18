import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { TrialExpiring } from "@/lib/email/templates/trial-expiring"
import { TrialExpired } from "@/lib/email/templates/trial-expired"

export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()
  const now = new Date()
  const sent: string[] = []
  const errors: string[] = []

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name, trial_ends_at")
    .eq("subscription_tier", "free")
    .not("trial_ends_at", "is", null)

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ sent: 0, errors: [] })
  }

  for (const org of orgs) {
    if (!org.trial_ends_at) continue

    const trialEnd = new Date(org.trial_ends_at)
    const diffMs = trialEnd.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

    let emailType: "3day" | "1day" | "expired" | null = null
    if (diffDays === 3) emailType = "3day"
    else if (diffDays === 1) emailType = "1day"
    else if (diffDays <= 0) emailType = "expired"
    else continue

    const { data: members } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", org.id)
      .eq("role", "owner")

    if (!members || members.length === 0) continue

    for (const member of members) {
      const { data: profile } = await admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", member.user_id)
        .maybeSingle()

      if (!profile?.email) continue

      const userName = profile.full_name ?? profile.email.split("@")[0]
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
      const upgradeUrl = `${appUrl}/settings/billing`

      try {
        if (emailType === "expired") {
          await sendEmail({
            to: profile.email,
            subject: "Your Vatic trial has ended",
            react: TrialExpired({ userName, upgradeUrl }),
            clientFacing: true,
            overrideClientEmailPause: false,
          })
        } else {
          const daysLeft = emailType === "3day" ? 3 : 1

          const { count } = await admin
            .from("insights")
            .select("id", { count: "exact", head: true })
            .in(
              "location_id",
              (
                await admin
                  .from("locations")
                  .select("id")
                  .eq("organization_id", org.id)
              ).data?.map((l) => l.id) ?? []
            )

          await sendEmail({
            to: profile.email,
            subject:
              daysLeft === 1
                ? "Last day of your Vatic trial"
                : `Your Vatic trial ends in ${daysLeft} days`,
            react: TrialExpiring({
              userName,
              daysLeft,
              insightsGenerated: count ?? 0,
              upgradeUrl,
            }),
            clientFacing: true,
            overrideClientEmailPause: false,
          })
        }
        sent.push(`${emailType}:${profile.email}`)
      } catch (err) {
        errors.push(
          `${emailType}:${profile.email}:${err instanceof Error ? err.message : "unknown"}`
        )
      }
    }
  }

  return NextResponse.json({ sent: sent.length, details: sent, errors })
}
