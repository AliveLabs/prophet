"use server"

// ALT-695 — the LOGGED-OUT support door.
//
// The locked-out operator is a real support case and currently the least able to reach us: the app
// subdomain redirects / to /login, so this form is the only door they have. It writes to the same
// `beta_feedback` table as the authed launcher, so there is one queue and one Notion pipeline.
//
// ── 🔒 Why this uses the ADMIN client and NOT an anon RLS policy ─────────────────────────────
// Granting `anon` INSERT on beta_feedback would open the table to anyone holding the publishable
// key, and the publishable key ships in the client bundle by definition. Keeping the write inside a
// server action, behind validation and rate limiting, IS the protection. Do not "simplify" this by
// adding an anon policy.
//
// ── Abuse: two lines, because the first one fails open ───────────────────────────────────────
// lib/http/rate-limit.ts fails OPEN when Upstash is unconfigured. That is the right call for the
// auth-gated endpoints it was written for and the wrong one for a public endpoint that sends mail,
// so there is a second check that counts recent rows for the same email straight from Postgres and
// needs no Redis. Plus a honeypot field, which costs nothing and catches naive bots.

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { BetaFeedbackEmail } from "@/lib/email/templates/beta-feedback"
import { createFeedbackTicket } from "@/lib/feedback/notion"
import { rateLimit } from "@/lib/http/rate-limit"
import { headers } from "next/headers"
import {
  normalizeCategory,
  normalizeMessage,
  normalizeEmail,
  normalizeBusinessName,
  referenceFor,
  isSigninSubject,
} from "@/lib/feedback/feedback"

const OPS_RECIPIENTS = (process.env.OPS_ALERT_EMAILS ?? "bryan@alivelabs.io,chris@alivelabs.io")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

/** Max anonymous requests per email per window, enforced in Postgres so it survives a missing
 *  Redis. Generous: a genuinely stuck person may legitimately write twice. */
const DB_LIMIT_PER_EMAIL = 5
const DB_LIMIT_WINDOW_MINUTES = 60

export type SupportSubmitResult =
  | { ok: true; reference: string }
  | { ok: false; error: string }

type LooseClient = {
  from: (t: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{
          data: { id: string; created_at: string } | null
          error: { message: string } | null
        }>
      }
    }
    update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> }
    select: (cols: string, opts?: unknown) => {
      eq: (c: string, v: string) => { gte: (c: string, v: string) => Promise<{ count: number | null }> }
    }
  }
}

export async function submitSupportRequest(input: {
  email: string
  businessName: string
  subject?: string | null
  message: string
  /** Honeypot. A real person never fills this in; it is visually hidden and off the tab order. */
  website?: string | null
}): Promise<SupportSubmitResult> {
  // Honeypot first: cheapest possible rejection, and it must look like success so a bot learns
  // nothing from the response.
  if ((input.website ?? "").trim().length > 0) {
    return { ok: true, reference: "TK-000000" }
  }

  const email = normalizeEmail(input.email)
  if (!email) return { ok: false, error: "Enter an email address we can reply to." }

  const businessName = normalizeBusinessName(input.businessName)
  if (!businessName) return { ok: false, error: "Tell us your restaurant name so we can find your account." }

  const message = normalizeMessage(input.message)
  if (!message) return { ok: false, error: "Add a few words about what is happening." }

  // Only the sign-in subjects belong on this door. Anything else is either a bad client or someone
  // probing, and either way it lands as an uncategorised request rather than being rejected: the
  // message is the truth, the subject only routes.
  const raw = normalizeCategory(input.subject)
  const subject = isSigninSubject(raw) ? raw : null

  let ip = "unknown"
  try {
    const h = await headers()
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown"
  } catch {
    /* headers() unavailable in some contexts, non-fatal */
  }

  // Line 1: Redis, when configured.
  for (const [id, prefix, limit, windowSeconds] of [
    [email, "support-email", 5, 3600],
    [ip, "support-ip", 15, 3600],
  ] as const) {
    const r = await rateLimit(id, { prefix, limit, windowSeconds })
    if (!r.ok) {
      return {
        ok: false,
        error: "We have a few requests from you already. Give us a little time to reply to those first.",
      }
    }
  }

  const admin = createAdminSupabaseClient() as unknown as LooseClient

  // Line 2: Postgres, which needs no Redis. Uses beta_feedback_email_created_idx.
  try {
    const since = new Date(Date.now() - DB_LIMIT_WINDOW_MINUTES * 60_000).toISOString()
    const { count } = await admin
      .from("beta_feedback")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", since)
    if ((count ?? 0) >= DB_LIMIT_PER_EMAIL) {
      return {
        ok: false,
        error: "We have a few requests from you already. Give us a little time to reply to those first.",
      }
    }
  } catch (err) {
    // Same posture as the Redis limiter: a failed guard must not block a real support request.
    console.warn("[support] db rate check failed; allowing:", err)
  }

  const { data: row, error } = await admin
    .from("beta_feedback")
    .insert({
      // No org, no user: that is the whole point of this door. The beta_feedback_reachable check
      // constraint is what guarantees email + business_name are present instead.
      organization_id: null,
      user_id: null,
      location_id: null,
      category: subject,
      message,
      email,
      business_name: businessName,
      page_path: "/support",
      user_agent: null,
    })
    .select("id, created_at")
    .single()

  if (error || !row) {
    console.error("[support] insert failed:", error?.message ?? "no row returned")
    return { ok: false, error: "That didn't send. Please try again." }
  }

  const reference = referenceFor(row.id)

  // Best-effort fan-out. The row is the record of truth; a vendor outage must never turn "we have
  // your request" into an error for someone who is already locked out and frustrated. An
  // unticketed row is picked up by /api/cron/feedback-notion-sync.
  try {
    const ticket = await createFeedbackTicket({
      feedbackId: row.id,
      message,
      category: subject,
      pagePath: "/support (not signed in)",
      userEmail: email,
      orgName: businessName,
      createdAt: row.created_at,
    })
    if (ticket.ok) {
      await admin
        .from("beta_feedback")
        .update({
          notion_page_id: ticket.pageId,
          notion_synced_at: new Date().toISOString(),
          notion_error: null,
        })
        .eq("id", row.id)
    } else if (!ticket.skipped) {
      console.error("[support] notion ticket failed:", ticket.error)
      await admin
        .from("beta_feedback")
        .update({ notion_error: ticket.error.slice(0, 500) })
        .eq("id", row.id)
    }

    await sendEmail({
      to: OPS_RECIPIENTS,
      subject: `[Ticket] Support request ${reference}: ${businessName}`,
      react: BetaFeedbackEmail({
        message,
        category: subject ?? undefined,
        pagePath: "/support (not signed in)",
        userEmail: email,
        orgName: businessName,
      }),
    })
  } catch (err) {
    console.error("[support] fan-out failed (request still saved):", err)
  }

  return { ok: true, reference }
}
