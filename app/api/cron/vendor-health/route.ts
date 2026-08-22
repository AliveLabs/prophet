import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { detectDataForSeoHealth } from "@/lib/jobs/vendor-health"
import { sendEmail } from "@/lib/email/send"
import { VendorHealthAlert } from "@/lib/email/templates/vendor-health-alert"
import { postSlackAlert } from "@/lib/ops/slack"
import { ZeroYieldAlert } from "@/lib/email/templates/zero-yield-alert"
import {
  alertableVerdicts,
  describeVerdict,
  detectZeroYield,
  type ZeroYieldReport,
} from "@/lib/jobs/zero-yield"
import type { SB } from "@/lib/jobs/queue"

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

  // ALT-571: the zero-yield pass runs on EVERY invocation, independently of the vendor verdict
  // above, and its result is returned whether or not it alerted. The two detectors answer
  // different questions and must not gate each other: the 2026-08 blackout had a perfectly
  // healthy vendor verdict for five days because every call returned HTTP 200 with an empty list.
  const zeroYield = await runZeroYieldPass(admin, isProd)

  const wantsAlert = verdict.status === "newly_down" || verdict.status === "recovered"
  if (!wantsAlert || !isProd) {
    return NextResponse.json({ ok: true, verdict, alerted: false, isProd, zeroYield })
  }

  const url = dashboardUrl()

  // Recovery: a lightweight Slack note (no email — the failure alert already paged).
  if (verdict.status === "recovered") {
    const slack = await postSlackAlert(`:white_check_mark: *${VENDOR_LABEL} recovered*: pulls are succeeding again across the fleet.`)
    return NextResponse.json({ ok: true, verdict, alerted: true, kind: "recovered", slack, zeroYield })
  }

  // newly_down: page ops on both channels.
  const subject = verdict.paymentRequired
    ? `[Ticket] ${VENDOR_LABEL} is out of credits: ${verdict.downLocations}/${verdict.totalLocations} locations affected`
    : `[Ticket] ${VENDOR_LABEL} data source failing: ${verdict.downLocations}/${verdict.totalLocations} locations affected`

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

  return NextResponse.json({ ok: true, verdict, alerted: true, kind: "newly_down", email, slack, zeroYield })
}

// ── ALT-571: unexpected-zero pass ───────────────────────────────────────────
//
// Separate from the vendor verdict above because it detects the opposite shape. That one asks "did
// the call fail?"; this asks "did the call succeed and bring back nothing?" The 2026-08 events
// blackout was five consecutive nights of the second, and the first reported healthy throughout.
//
// Shares this cron rather than adding another: it needs the same daily schedule, the same auth, the
// same prod gate, and the same two channels. The ticket is explicit that this needs the right
// trigger and recipients, not new infrastructure.

type ZeroYieldOutcome = {
  report: ZeroYieldReport
  alerted: boolean
  escalated: boolean
  paged: string[]
  email?: unknown
  slack?: unknown
}

async function runZeroYieldPass(admin: SB, isProd: boolean): Promise<ZeroYieldOutcome> {
  const report = await detectZeroYield(admin)
  const paging = alertableVerdicts(report)
  const paged = paging.map((v) => v.provider)

  // A blind read must be loud in the logs even though it cannot page: an empty `verdicts` here
  // means "we could not look", and reporting that as all-clear is the exact mistake ALT-745 was.
  if (report.readError) {
    console.error(`[zero-yield] BLIND for ${report.asOfDateKey}: ${report.readError}`)
  }

  if (paging.length === 0 || !isProd) {
    return { report, alerted: false, escalated: false, paged }
  }

  const escalated = paging.some((v) => v.escalation === "escalated")
  const worst = paging[0]!
  const subject = escalated
    ? `[Ticket] ${worst.label} still returning zero: ${worst.consecutiveZeroDays} consecutive nights`
    : `[Ticket] ${worst.label} returned zero for the fleet`

  const email = await sendEmail({
    to: OPS_RECIPIENTS,
    subject,
    react: ZeroYieldAlert({
      lines: paging.map((v) => ({
        label: v.label,
        status: v.status,
        detail: describeVerdict(v),
        consecutiveZeroDays: v.consecutiveZeroDays,
      })),
      escalated,
      asOfDateKey: report.asOfDateKey,
      dashboardUrl: dashboardUrl(),
    }),
    // clientFacing defaults to false -> internal alert, bypasses the CLIENT_EMAILS_ENABLED pause.
  })

  const slack = await postSlackAlert(
    [
      escalated
        ? `:rotating_light: *Unexpected zero, ${worst.consecutiveZeroDays} consecutive nights*`
        : `:warning: *Unexpected zero*`,
      `These pulls SUCCEEDED and returned nothing, so no vendor-failure alert fires for them.`,
      ...paging.map((v) => `> ${describeVerdict(v)}`),
      dashboardUrl(),
    ].join("\n"),
  )

  return { report, alerted: true, escalated, paged, email, slack }
}
