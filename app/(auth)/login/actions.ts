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

const NO_ACCOUNT_MESSAGE =
  "We couldn't find an account for that email. Use the address you signed up with, or contact us and we'll get you set up."

/**
 * Create the auth account for someone who is already on the waitlist but has no
 * account yet, so a magic link has something to sign.
 *
 * This closes the gap the 2026-08 beta cohort fell into: they were emailed a link
 * to /login directly, without anyone clicking Approve in /admin/waitlist. Approve
 * is the ONLY path that calls auth.admin.createUser, so `generateLink` had no user
 * to issue a link for and the sign-in form could not succeed no matter how many
 * times they tried.
 *
 * Deliberately narrow: an email already on the waitlist and not declined. This is
 * not open signup — a stranger still gets NO_ACCOUNT_MESSAGE. The marketing site's
 * waitlist form remains the front door.
 */
async function provisionWaitlistUser(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  email: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // waitlist_signups stores emails lower-cased + trimmed (app/api/waitlist/route.ts).
  const { data: signup } = await admin
    .from("waitlist_signups")
    .select("status, first_name, last_name")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle()

  // Same copy for "not on the list" and "declined" — a sign-in form should not
  // report which addresses we hold or what we decided about them.
  if (!signup || signup.status === "declined") {
    return { ok: false, error: NO_ACCOUNT_MESSAGE }
  }

  const fullName =
    [signup.first_name, signup.last_name].filter(Boolean).join(" ") || null

  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  })

  if (error) {
    console.error("[auth] waitlist user provisioning failed:", error.message)
    return {
      ok: false,
      error: "We couldn't set up your account just now. Try again in a moment.",
    }
  }

  return { ok: true }
}

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

  let { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  })

  // `generateLink` type 'magiclink' signs a link for an EXISTING user. If there is
  // none, provision the account (waitlist members only) and retry once.
  if (error || !data?.properties?.action_link) {
    const provisioned = await provisionWaitlistUser(supabase, email)
    if (!provisioned.ok) {
      redirect(`${redirectPath}?error=${encodeURIComponent(provisioned.error)}`)
    }

    ;({ data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    }))
  }

  if (error || !data?.properties?.action_link) {
    console.error(
      "[auth] magic link generation failed after provisioning:",
      error?.message ?? "no action_link"
    )
    redirect(
      `${redirectPath}?error=${encodeURIComponent("We couldn't send a sign-in link just now. Try again in a moment.")}`
    )
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
