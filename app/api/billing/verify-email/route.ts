import { NextRequest, NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { tokensMatch } from "@/lib/billing/email-verification"

// GET /api/billing/verify-email?org=<id>&token=<raw token>
//
// ALT-227: the link an operator clicks from BillingEmailVerification. Public —
// intentionally not auth-gated, since clicking it IS the proof of mailbox
// ownership. Safe because the token is a 256-bit random value, only its sha256
// hash is ever persisted, and it is single-use + time-limited (24h).
export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  const orgId = request.nextUrl.searchParams.get("org")
  const token = request.nextUrl.searchParams.get("token")

  const fail = (message: string) =>
    NextResponse.redirect(`${appUrl}/settings/organization?error=${encodeURIComponent(message)}`)

  if (!orgId || !token) return fail("Invalid verification link.")

  const supabase = createAdminSupabaseClient()
  const { data: org } = await supabase
    .from("organizations")
    .select("pending_billing_email, billing_email_token_hash, billing_email_token_expires_at")
    .eq("id", orgId)
    .maybeSingle()

  if (!org?.pending_billing_email || !org.billing_email_token_hash) {
    return fail("This verification link has already been used or is no longer valid.")
  }

  const expiresAt = org.billing_email_token_expires_at
    ? new Date(org.billing_email_token_expires_at).getTime()
    : 0
  if (!expiresAt || Date.now() > expiresAt) {
    return fail("This verification link has expired — request a new one from Organization settings.")
  }

  if (!tokensMatch(org.billing_email_token_hash, token)) {
    return fail("This verification link is invalid.")
  }

  // Single-use: clear the token fields in the same write that applies the
  // email, so a repeat click on the same link hits the "no longer valid" path.
  const { error } = await supabase
    .from("organizations")
    .update({
      billing_email: org.pending_billing_email,
      pending_billing_email: null,
      billing_email_token_hash: null,
      billing_email_token_expires_at: null,
      billing_email_token_sent_at: null,
    })
    .eq("id", orgId)

  if (error) return fail("Something went wrong confirming your billing email — try again.")

  return NextResponse.redirect(
    `${appUrl}/settings/organization?success=${encodeURIComponent("Billing email verified and updated.")}`,
  )
}
