// ALT-227: billing email change verification — the new email is held pending
// until its owner clicks a single-use, time-limited link. Only the sha256 hash
// of the token is ever persisted (same convention as lib/insights/hash.ts etc.);
// the raw token only ever exists in the outbound email + the incoming request.

import { randomBytes, createHash, timingSafeEqual } from "crypto"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { BillingEmailVerification } from "@/lib/email/templates/billing-email-verification"
import { BillingEmailChangeNotice } from "@/lib/email/templates/billing-email-change-notice"

export const BILLING_EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24h
export const BILLING_EMAIL_RESEND_COOLDOWN_MS = 2 * 60 * 1000 // 2min

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function tokensMatch(storedHash: string, candidateToken: string): boolean {
  const a = Buffer.from(storedHash, "hex")
  const b = Buffer.from(hashToken(candidateToken), "hex")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Request (or re-request) a billing email change: holds `newEmail` as pending,
 * emails a verification link to it, and best-effort notifies `previousEmail`
 * (if any) that a change was requested — `billing_email` is untouched until
 * the link is clicked. Rate-limited: re-requesting the SAME pending email
 * within the cooldown window is rejected rather than spamming a new token.
 */
export async function requestBillingEmailChange(
  orgId: string,
  newEmail: string,
  previousEmail: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createAdminSupabaseClient()

  const { data: org } = await supabase
    .from("organizations")
    .select("pending_billing_email, billing_email_token_sent_at")
    .eq("id", orgId)
    .maybeSingle()

  const sentAt = org?.billing_email_token_sent_at
    ? new Date(org.billing_email_token_sent_at).getTime()
    : 0
  const withinCooldown = Date.now() - sentAt < BILLING_EMAIL_RESEND_COOLDOWN_MS
  if (withinCooldown && org?.pending_billing_email === newEmail) {
    return {
      ok: false,
      error: "a verification email was already sent — check that inbox, or wait a couple minutes to resend.",
    }
  }

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + BILLING_EMAIL_TOKEN_TTL_MS).toISOString()

  const { error } = await supabase
    .from("organizations")
    .update({
      pending_billing_email: newEmail,
      billing_email_token_hash: hashToken(token),
      billing_email_token_expires_at: expiresAt,
      billing_email_token_sent_at: new Date().toISOString(),
    })
    .eq("id", orgId)

  if (error) return { ok: false, error: error.message }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  const verifyUrl = `${appUrl}/api/billing/verify-email?org=${orgId}&token=${token}`

  const sent = await sendEmail({
    to: newEmail,
    subject: "Confirm your billing email",
    react: BillingEmailVerification({ verifyUrl }),
    clientFacing: true,
    overrideClientEmailPause: true,
  })

  if (!sent.ok) {
    return { ok: false, error: "we couldn't send the verification email — try again." }
  }

  // Security notice only — never blocks the request on failure.
  if (previousEmail) {
    void sendEmail({
      to: previousEmail,
      subject: "Your billing email change was requested",
      react: BillingEmailChangeNotice({ newEmail }),
      clientFacing: true,
      overrideClientEmailPause: true,
    }).catch(() => {})
  }

  return { ok: true }
}
