import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { detectDataForSeoHealth } from "@/lib/jobs/vendor-health"
import { sendEmail } from "@/lib/email/send"
import { VendorHealthAlert } from "@/lib/email/templates/vendor-health-alert"
import { postSlackAlert } from "@/lib/ops/slack"

export const maxDuration = 60

// Daily vendor-health check. Detects when a data vendor (DataForSEO: events + search-visibility)
// is down fleet-wide and alerts ops via email + Slack. Built after the 2026-06 DataForSEO 402
// outage went unnoticed for ~a week because every failure was laundered into a generic
// "partial"/"failed" run with no alert. Debounce is table-free: detectDataForSeoHealth compares
// health now vs 24h ago, so we alert ONCE on the healthy->down transition (status "newly_down")
// and once when it clears ("recovered"), not every day the outage persists.

const OPS_RECIPIENTS = (process.env.OPS_ALERT_EMAILS ?? "bryan@alivelabs.io,chris@alivelabs.io")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

const VENDOR_LABEL = "DataForSEO"

function dashboardUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.getticket.ai"
  return `${base.replace(/\/$/, "")}/admin`
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  // Strict guard (matches daily/worker): an internal endpoint must never be open when the secret is unset.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()
  const verdict = await detectDataForSeoHealth(admin)

  // Only send from production so a preview/dev run can never page ops (ops emails bypass the
  // CLIENT_EMAILS_ENABLED pause, so they would otherwise fire everywhere).
  const isProd = process.env.VERCEL_ENV === "production"
  const wantsAlert = verdict.status === "newly_down" || verdict.status === "recovered"
  if (!wantsAlert || !isProd) {
    return NextResponse.json({ ok: true, verdict, alerted: false, isProd })
  }

  const url = dashboardUrl()

  // Recovery: a lightweight Slack note (no email — the failure alert already paged).
  if (verdict.status === "recovered") {
    const slack = await postSlackAlert(`:white_check_mark: *${VENDOR_LABEL} recovered* — pulls are succeeding again across the fleet.`)
    return NextResponse.json({ ok: true, verdict, alerted: true, kind: "recovered", slack })
  }

  // newly_down: page ops on both channels.
  const subject = verdict.paymentRequired
    ? `[Ticket] ${VENDOR_LABEL} is out of credits — ${verdict.downLocations}/${verdict.totalLocations} locations affected`
    : `[Ticket] ${VENDOR_LABEL} data source failing — ${verdict.downLocations}/${verdict.totalLocations} locations affected`

  const email = await sendEmail({
    to: OPS_RECIPIENTS,
    subject,
    react: VendorHealthAlert({
      vendor: VENDOR_LABEL,
      paymentRequired: verdict.paymentRequired,
      downLocations: verdict.downLocations,
      totalLocations: verdict.totalLocations,
      sampleReason: verdict.sampleReason,
      dashboardUrl: url,
    }),
    // clientFacing defaults to false -> internal alert, bypasses the CLIENT_EMAILS_ENABLED pause.
  })

  const slackText = [
    verdict.paymentRequired
      ? `:rotating_light: *${VENDOR_LABEL} is out of credits*`
      : `:warning: *${VENDOR_LABEL} data source failing*`,
    `${verdict.downLocations}/${verdict.totalLocations} active locations have failing events / search-visibility pulls.`,
    verdict.paymentRequired ? `Refill the ${VENDOR_LABEL} account to restore pulls.` : `Check the vendor account / status.`,
    verdict.sampleReason ? `> ${verdict.sampleReason.slice(0, 200)}` : "",
    url,
  ]
    .filter(Boolean)
    .join("\n")
  const slack = await postSlackAlert(slackText)

  return NextResponse.json({ ok: true, verdict, alerted: true, kind: "newly_down", email, slack })
}
