"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { MagicLinkEmail } from "@/lib/email/templates/magic-link"
import { getAuthCallbackUrl } from "@/lib/auth/app-url"
import { rateLimit } from "@/lib/http/rate-limit"

function safeRedirectPath(input: string | null) {
  if (!input) {
    return "/login"
  }
  if (input.startsWith("/") && !input.startsWith("//")) {
    return input
  }
  return "/login"
}

// `generateLink` type 'magiclink' only signs a link for an EXISTING auth user, and the
// only paths that create one are waitlist Approve and the team invite. So an address
// with no account cannot be sent a link, and no email is sent either — which reads to
// the operator as "nothing happened". Say so plainly instead of surfacing the raw
// GoTrue error, and don't reveal whether we hold the address.
//
// Provisioning an account here (for waitlist members) was prototyped and pulled back
// out: it changes WHO gets an account, no one in the 2026-08 beta cohort actually hit
// this path, and it deserves its own review rather than riding along with a UI fix.
const NO_ACCOUNT_MESSAGE =
  "We couldn't find an account for that email. Use the address you signed up with, or contact us and we'll get you set up."

export async function sendMagicLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim()
  const redirectPath = safeRedirectPath(
    String(formData.get("redirect_to") ?? "/login")
  )

  if (!email) {
    redirect(`${redirectPath}?error=Missing%20email`)
  }

  // Unauthenticated and it sends mail on demand — cap it per address so this
  // can't be turned into an email bomb. Fail-open, like every other rateLimit use.
  const rl = await rateLimit(email.toLowerCase(), {
    prefix: "magic-link",
    limit: 5,
    windowSeconds: 900,
  })
  if (!rl.ok) {
    redirect(
      `${redirectPath}?error=${encodeURIComponent("Too many sign-in links requested. Wait a few minutes and try again.")}`
    )
  }

  const supabase = createAdminSupabaseClient()
  const redirectTo = getAuthCallbackUrl()

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  })

  if (error || !data?.properties?.action_link) {
    // Log the real reason for us; show the operator copy they can act on.
    console.error(
      "[auth] magic link generation failed:",
      error?.message ?? "no action_link"
    )
    redirect(`${redirectPath}?error=${encodeURIComponent(NO_ACCOUNT_MESSAGE)}`)
  }

  const result = await sendEmail({
    to: email,
    subject: "Sign in to Ticket",
    react: MagicLinkEmail({ email, magicLinkUrl: data.properties.action_link }),
    clientFacing: true,
    overrideClientEmailPause: true,
  })

  if (!result.ok) {
    redirect(
      `${redirectPath}?error=${encodeURIComponent("Failed to send magic link email. Please try again.")}`
    )
  }

  redirect(`${redirectPath}?sent=1`)
}

export async function signInWithGoogleAction() {
  const redirectUrl = getAuthCallbackUrl()

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl,
    },
  })

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  if (data?.url) {
    redirect(data.url)
  }

  redirect("/login?error=Unable%20to%20start%20Google%20sign%20in")
}
