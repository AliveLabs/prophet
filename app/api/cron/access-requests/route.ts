import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { AccessRequest } from "@/lib/email/templates/access-request"
import {
  planAccessRequestTransition,
  type AccessRequestStatus,
} from "@/lib/onboarding/access-request"
import {
  loadOrgManagerRecipients,
  notifyOps,
} from "@/lib/onboarding/access-request-notify"

export const maxDuration = 60

// Daily cron for org access requests (duplicate-org prevention, beta rescue phase 3.5).
// Walks every OPEN request (pending / nudged / escalated, both kinds) and:
//
//   1. GRANT-DETECT (all kinds, all open statuses): the requester now appears in
//      organization_members for that org -> status 'granted'. Granting itself happens
//      through the owner's normal Settings -> Team invite (or an admin action); this is
//      how the request record learns about it, so no owner-facing "grant" button exists.
//   2. request_access lifecycle per lib/onboarding/access-request.ts:
//        pending, day 4  -> re-email the owner (nudge) and mark 'nudged'
//        nudged,  day 7  -> notify us (ops Slack + inbox) and mark 'escalated'
//        pending/nudged, day 30 -> 'expired'
//      'escalated' rows never auto-expire: a human explicitly asked us for help.
//
// Status transitions are the dedupe: one daily run, one step per request per day, so a
// nudge can never send twice (the row is 'nudged' afterwards) and cron downtime catches
// up one step at a time.

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  // Missing CRON_SECRET must FAIL CLOSED (matches the worker/build-brief/trial-reminders guard).
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminSupabaseClient()
  const now = new Date()
  const granted: string[] = []
  const nudged: string[] = []
  const escalated: string[] = []
  const expired: string[] = []
  const errors: string[] = []

  const { data: requests, error } = await admin
    .from("org_access_requests")
    .select("id, organization_id, requester_user_id, requester_name, requester_email, kind, status, created_at")
    .in("status", ["pending", "nudged", "escalated"])
    .order("created_at", { ascending: true })
    .limit(200)

  if (error) {
    console.error("access-requests query failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!requests || requests.length === 0) {
    return NextResponse.json({ granted, nudged, escalated, expired, errors })
  }

  // One membership read for the whole batch instead of one per request.
  const userIds = Array.from(new Set(requests.map((r) => r.requester_user_id)))
  const orgIds = Array.from(new Set(requests.map((r) => r.organization_id)))
  const { data: memberRows, error: memberErr } = await admin
    .from("organization_members")
    .select("organization_id, user_id")
    .in("user_id", userIds)
    .in("organization_id", orgIds)
  if (memberErr) {
    // Without memberships we can't tell granted from waiting; nudging someone who was
    // already added is worse than skipping a day, so bail and let tomorrow's run retry.
    console.error("access-requests membership read failed:", memberErr)
    return NextResponse.json({ error: memberErr.message }, { status: 500 })
  }
  const membershipKeys = new Set(
    (memberRows ?? []).map((m) => `${m.organization_id}:${m.user_id}`)
  )

  // Org names for the nudge email; loaded once.
  const { data: orgRows } = await admin
    .from("organizations")
    .select("id, name, deleted_at")
    .in("id", orgIds)
  const orgById = new Map((orgRows ?? []).map((o) => [o.id, o]))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

  for (const req of requests) {
    try {
      // 1. Grant detection, any kind, any open status.
      if (membershipKeys.has(`${req.organization_id}:${req.requester_user_id}`)) {
        const { error: updErr } = await admin
          .from("org_access_requests")
          .update({
            status: "granted",
            resolved_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", req.id)
        if (updErr) throw new Error(updErr.message)
        granted.push(req.id)
        continue
      }

      // The org vanished or was soft-deleted since the request: nothing left to join.
      const org = orgById.get(req.organization_id)
      if (!org || org.deleted_at) {
        const { error: updErr } = await admin
          .from("org_access_requests")
          .update({
            status: "expired",
            resolved_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", req.id)
        if (updErr) throw new Error(updErr.message)
        expired.push(req.id)
        continue
      }

      if (req.kind !== "request_access") continue

      // 2. Time-based lifecycle (pure decision, I/O here).
      const plan = planAccessRequestTransition(
        { status: req.status as AccessRequestStatus, createdAt: req.created_at },
        now
      )
      if (plan === "none") continue

      if (plan === "expire") {
        const { error: updErr } = await admin
          .from("org_access_requests")
          .update({
            status: "expired",
            resolved_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", req.id)
        if (updErr) throw new Error(updErr.message)
        expired.push(req.id)
        continue
      }

      if (plan === "nudge") {
        // Mark BEFORE sending (trial-reminders precedent): a send that fails retries via
        // tomorrow's escalation step rather than double-nudging the owner.
        const { error: updErr } = await admin
          .from("org_access_requests")
          .update({
            status: "nudged",
            nudged_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", req.id)
        if (updErr) throw new Error(updErr.message)

        const recipients = await loadOrgManagerRecipients(admin, req.organization_id)
        const requesterName = req.requester_name ?? req.requester_email ?? "A teammate"
        await Promise.all(
          recipients.map((r) =>
            sendEmail({
              to: r.email,
              subject: `Reminder: ${requesterName} is waiting to join ${org.name} on Ticket`,
              react: AccessRequest({
                ownerName: r.name,
                requesterName,
                requesterEmail: req.requester_email ?? "unknown",
                orgName: org.name,
                teamUrl: `${appUrl}/settings/team`,
                nudge: true,
              }),
              clientFacing: true,
              // Same reasoning as the invite email: a person is waiting on this.
              overrideClientEmailPause: true,
            }).catch((err) => console.error(`[access-requests] nudge send failed for ${req.id}:`, err))
          )
        )
        nudged.push(req.id)
        continue
      }

      // plan === "escalate": the owner never acted; pull us in.
      const { error: updErr } = await admin
        .from("org_access_requests")
        .update({
          status: "escalated",
          escalated_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", req.id)
      if (updErr) throw new Error(updErr.message)

      await notifyOps("Access request unanswered for a week", [
        `${req.requester_name ?? "Someone"} (${req.requester_email ?? req.requester_user_id}) asked to join "${org.name}" (${req.organization_id}) and the owner has not added them after a nudge.`,
        "Reach out to both sides. Validate before any ownership change.",
      ])
      escalated.push(req.id)
    } catch (err) {
      errors.push(`${req.id}:${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return NextResponse.json({ granted, nudged, escalated, expired, errors })
}
