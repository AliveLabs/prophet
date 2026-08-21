// ---------------------------------------------------------------------------
// GET /api/cron/weekly-digest (hourly) — the highlights email that drives
// operators back to their brief.
//
// SENDS ARE OFF BY DEFAULT (D6 gate). The route hard-stops unless
// WEEKLY_DIGEST_EMAILS_ENABLED === "true" — a dedicated per-email override,
// like the billing emails' overrideClientEmailPause, NEVER the global
// CLIENT_EMAILS_ENABLED flip (that would also unpause welcome +
// waitlist-confirm). History: the digest shipped in the spine rewrite gated
// behind `clientFacing: true`, and CLIENT_EMAILS_ENABLED stayed off in prod,
// so it has never sent — this flag replaces that accidental pause with a
// deliberate, digest-only dial.
//
// Scheduling (D6 rulings): per-USER preferred day (profiles.weekly_digest_day,
// Monday default), delivered in the recipient's local morning — same
// hourly-cron + local-clock filter the daily brief uses (build-schedule.ts).
// Dedupe: insert into public.weekly_digest_sends BEFORE sending (the
// trial_reminder_sends pattern) so the catch-up window can't double-send.
// Per location: active access only, respects
// locations.settings.communications.weekly_digest. Auth: Bearer CRON_SECRET.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isTrialActive } from "@/lib/billing/trial"
import { getBrief } from "@/lib/insights/daily-brief"
import { sendEmail } from "@/lib/email/send"
import { WeeklyDigest } from "@/lib/email/templates/weekly-digest"
import { loadActiveWatchEvents } from "@/lib/reviews/watch-events"
import { buildWatchNotices } from "@/lib/reviews/watch-copy"
import { stripAccents } from "@/lib/text/accents"
import {
  DIGEST_SENDS_DISABLED_REASON,
  digestDateKey,
  isWeeklyDigestSendEnabled,
  resolveDigestCatchupHours,
  resolveDigestDay,
  resolveDigestHour,
  shouldSendDigestNow,
} from "@/lib/email/digest-schedule"

export const maxDuration = 300

// profiles.weekly_digest_day + weekly_digest_sends land in migration
// 20260813120000 (NOT yet applied); loose casts below keep this compiling
// against the current generated types, same convention as
// generosity_threshold (settings/actions.ts).
type ProfileRow = { id: string; email: string | null; weekly_digest_day?: unknown }
type LooseAdmin = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, vals: string[]) => Promise<{ data: ProfileRow[] | null }>
    }
    insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string; message?: string } | null }>
  }
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  // D6 HARD STOP — before any DB read or brief fetch, so the OFF state is
  // unmistakable: no queries, no sends, one loud log line, an explicit body.
  if (!isWeeklyDigestSendEnabled()) {
    console.log(`[digest] SENDS DISABLED — ${DIGEST_SENDS_DISABLED_REASON}`)
    return Response.json({ enabled: false, sent: 0, reason: DIGEST_SENDS_DISABLED_REASON })
  }

  const admin = createAdminSupabaseClient()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.getticket.ai"
  const now = new Date()
  const sendHour = resolveDigestHour()
  const catchupHours = resolveDigestCatchupHours()

  const { data: locations, error } = await admin
    .from("locations")
    .select("id, name, organization_id, settings, timezone")
    .order("created_at", { ascending: true })
  if (error || !locations) {
    return Response.json({ error: "Failed to list locations", details: error?.message }, { status: 500 })
  }

  const orgIds = [...new Set(locations.map((l) => l.organization_id))]
  const { data: orgs, error: orgErr } = await admin
    .from("organizations")
    .select("id, subscription_tier, trial_ends_at, payment_state")
    .in("id", orgIds)
    .is("deleted_at", null)
  // ALT-743: unchecked, third of the three crons with this read. On failure `orgById` came out
  // empty, every location took the `!org` branch below and was reported as "no active access",
  // and not one digest went out. A silent zero-send week is indistinguishable here from a week
  // where nobody was entitled, which is why it needs to fail rather than report.
  if (orgErr || !orgs) {
    console.error(`[weekly-digest] entitlement allowlist read failed: ${orgErr?.code ?? ""} ${orgErr?.message ?? "no rows"}`)
    return Response.json(
      { error: "Failed to resolve active organizations", details: orgErr?.message },
      { status: 500 },
    )
  }
  const orgById = new Map(orgs.map((o) => [o.id, o]))

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

    const timezone = (loc as { timezone?: string | null }).timezone

    // Recipient resolution, and it was unchecked. On a read failure `userIds` came out empty, the
    // profiles read was skipped entirely, and the location was reported as `sent: 0` with no
    // reason: identical to a location where nobody was due today. Same shape as the entitlement
    // read above, one loop further in.
    const { data: members, error: membersError } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", loc.organization_id)
    if (membersError) {
      console.error(`[weekly-digest] member lookup failed for ${loc.id}: ${membersError.message}`)
      results.push({ locationId: loc.id, sent: 0, error: `member lookup failed: ${membersError.message}` })
      continue
    }
    const userIds = (members ?? []).map((m) => m.user_id)
    const { data: profiles } = userIds.length
      ? await (admin as unknown as LooseAdmin)
          .from("profiles")
          .select("id, email, weekly_digest_day")
          .in("id", userIds)
      : { data: [] as ProfileRow[] }

    // Per-user day filter FIRST, so a location with no one due today costs no
    // brief fetch. Recipient timezone = the location's zone (operators live
    // where their restaurant is; profiles carry no zone of their own).
    const seen = new Set<string>()
    const due = (profiles ?? []).filter((p) => {
      if (!p.email || seen.has(p.email)) return false
      seen.add(p.email)
      return shouldSendDigestNow(resolveDigestDay(p.weekly_digest_day), timezone, now, {
        sendHour,
        catchupHours,
      })
    })
    if (due.length === 0) {
      results.push({ locationId: loc.id, sent: 0, skipped: "no recipient due this tick" })
      continue
    }

    const brief = await getBrief(loc.id)
    if (!brief) {
      results.push({ locationId: loc.id, sent: 0, skipped: "no brief yet" })
      continue
    }

    // Phase 4.2: review changes the watchdog already recorded and that are still
    // inside their observation window. READ ONLY: no detection, no model call, and
    // nothing here decides whether an email sends (the D6 gate above owns that).
    // Two notices max, because the digest's job is one reason to open, not a list.
    const watchNotices = buildWatchNotices(await loadActiveWatchEvents(admin, loc.id))
      .slice(0, 2)
      .map((n) => ({ title: stripAccents(n.title), line: stripAccents(n.line) }))

    const dateKey = digestDateKey(timezone, now)
    let sent = 0
    const errors: string[] = []
    for (const recipient of due) {
      // Dedupe BEFORE sending (trial_reminder_sends pattern): a unique
      // violation means another tick in the catch-up window already took it.
      const { error: dedupeError } = await (admin as unknown as LooseAdmin)
        .from("weekly_digest_sends")
        .insert({ user_id: recipient.id, location_id: loc.id, date_key: dateKey })
      if (dedupeError) {
        if (dedupeError.code !== "23505") {
          errors.push(`${recipient.id}: ${dedupeError.message ?? "dedupe insert failed"}`)
        }
        continue
      }

      const res = await sendEmail({
        to: recipient.email as string,
        subject: `This week at ${loc.name ?? "your restaurant"}: ${stripAccents(brief.headline)}`,
        react: WeeklyDigest({
          locationName: loc.name ?? "your restaurant",
          headline: stripAccents(brief.headline),
          deck: brief.deck,
          plays: brief.plays.slice(0, 3).map((p) => ({ title: p.title, kind: p.kind })),
          briefUrl: `${appUrl}/home`,
          watchNotices,
          reviewsUrl: `${appUrl}/reviews?location_id=${loc.id}`,
          digestDayUrl: `${appUrl}/settings#weekly-digest`,
        }),
        clientFacing: true,
        // The per-email override IS the gate here: isWeeklyDigestSendEnabled()
        // already said yes at the top, and the global CLIENT_EMAILS_ENABLED
        // must not be the thing that unpauses the digest.
        overrideClientEmailPause: true,
      })
      if (res.ok) sent += 1
      else errors.push(`${recipient.id}: ${res.error}`)
    }
    results.push({ locationId: loc.id, sent, ...(errors.length ? { errors } : {}) })
  }

  const totalSent = results.reduce((n, r) => n + ((r.sent as number) ?? 0), 0)
  console.log(`[digest] sent ${totalSent} across ${results.length} locations`)
  return Response.json({ enabled: true, locations: results.length, sent: totalSent, results })
}
