"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { SignInCodeEmail } from "@/lib/email/templates/sign-in-code"
import { getAuthCallbackUrl } from "@/lib/auth/app-url"
import { rateLimit } from "@/lib/http/rate-limit"
import { normalizeEmailCode } from "@/lib/auth/email-code"

// The email flow is a one-time code verified ON the page it was requested from,
// with the emailed link as the secondary path. It replaced the link-only flow
// because paid social traffic arrives in the Facebook/Instagram in-app browser,
// where "open your inbox and come back" loses the visitor and Google OAuth is
// blocked outright (disallowed_useragent). One admin generateLink call yields
// both credentials: `email_otp` (the code) and `action_link` (the link).
//
// The state below drives the two-step client form (app/(auth)/auth-email-form.tsx)
// through useActionState. Request actions RETURN state so the page stays put for
// the code entry; only the verify action redirects, and only via a form action,
// never awaited inside a transition (see the NEXT_REDIRECT gotcha on
// switchOrganizationAction).

export type EmailAuthState =
  | { step: "email"; error?: string }
  | { step: "code"; email: string; error?: string }

// /signup creates the auth user before generating the code; /login never does.
// Login keeps saying so when the address has no account: an operator locked out
// on the wrong address needs to hear "wrong address", not receive a code that
// silently made a second empty account.
const NO_ACCOUNT_MESSAGE =
  "We couldn't find an account for that email. Use the address you signed up with, or contact us and we'll get you set up."

const SEND_FAILED_MESSAGE = "We couldn't send the email. Please try again."

// Login's no-account contract needs an EXPLICIT existence check. It used to
// lean on generateLink(type: "magiclink") erroring for unknown emails, but with
// project signups enabled (they must be, for Google OAuth) GoTrue quietly
// switches that call to a signup and CREATES the user - live-verified
// 2026-08-28: /login said "code sent" to a nonexistent address and left a
// stray account behind. There is no admin lookup-by-email in supabase-js and
// profiles rows are not guaranteed before onboarding, so the check is a
// createUser probe: `email_exists` proves the account; success means there was
// none, so the probe user is deleted on the spot and login says so. The
// request rate limit bounds probe volume.
async function emailHasAccount(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  email: string
): Promise<boolean | null> {
  const { data, error } = await supabase.auth.admin.createUser({ email })
  if (error) {
    if (error.code === "email_exists") return true
    console.error("[auth] account existence probe failed:", error.message)
    return null
  }
  if (data.user?.id) {
    const { error: undoErr } = await supabase.auth.admin.deleteUser(data.user.id)
    if (undoErr) {
      // Worst case the probe user survives as an empty unconfirmed account;
      // log loudly so it can be swept.
      console.error(
        "[auth] failed to undo existence probe for",
        data.user.id,
        undoErr.message
      )
    }
  }
  return false
}

async function requestEmailCode(
  mode: "signin" | "signup",
  formData: FormData
): Promise<EmailAuthState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()

  if (!email || !email.includes("@")) {
    return { step: "email", error: "Enter your email address." }
  }

  // Unauthenticated and it sends mail on demand: cap it per address so this
  // can't be turned into an email bomb. On /signup the same cap also bounds
  // account creation. Fail-open, like every other rateLimit use.
  const rl = await rateLimit(email, {
    prefix: "email-code",
    limit: 5,
    windowSeconds: 900,
  })
  if (!rl.ok) {
    return {
      step: "email",
      error: "Too many codes requested. Wait a few minutes and try again.",
    }
  }

  const supabase = createAdminSupabaseClient()

  if (mode === "signin") {
    const exists = await emailHasAccount(supabase, email)
    if (exists === null) return { step: "email", error: SEND_FAILED_MESSAGE }
    if (!exists) return { step: "email", error: NO_ACCOUNT_MESSAGE }
  }

  if (mode === "signup") {
    // Self-serve account creation (the waitlist gate is retired; paid ads point
    // here). `email_confirm: true` mirrors the waitlist-approve path and is safe
    // because no session exists until the code from their inbox is verified,
    // which is the same proof of address a confirmation would be.
    const { error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
    })
    if (createError && createError.code !== "email_exists") {
      console.error("[auth] signup user creation failed:", createError.message)
      return { step: "email", error: SEND_FAILED_MESSAGE }
    }
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: getAuthCallbackUrl() },
  })

  const code = data?.properties?.email_otp
  const actionLink = data?.properties?.action_link
  if (error || !code || !actionLink) {
    // Log the real reason for us; show the operator copy they can act on.
    console.error(
      "[auth] sign-in code generation failed:",
      error?.message ?? "missing email_otp/action_link"
    )
    // Existence is already settled in both modes by this point, so a
    // generateLink failure is a real failure, never "no account".
    return { step: "email", error: SEND_FAILED_MESSAGE }
  }

  const result = await sendEmail({
    to: email,
    // The code leads the subject so it shows in a notification banner without
    // opening the email — inside an in-app browser that is the whole ballgame.
    subject: `${code} is your Ticket ${mode === "signup" ? "signup" : "sign-in"} code`,
    react: SignInCodeEmail({ email, code, magicLinkUrl: actionLink, mode }),
    clientFacing: true,
    overrideClientEmailPause: true,
  })

  if (!result.ok) {
    return { step: "email", error: SEND_FAILED_MESSAGE }
  }

  return { step: "code", email }
}

export async function requestSignInCodeAction(
  _prev: EmailAuthState,
  formData: FormData
): Promise<EmailAuthState> {
  return requestEmailCode("signin", formData)
}

export async function requestSignupCodeAction(
  _prev: EmailAuthState,
  formData: FormData
): Promise<EmailAuthState> {
  return requestEmailCode("signup", formData)
}

export async function verifyEmailCodeAction(
  _prev: EmailAuthState,
  formData: FormData
): Promise<EmailAuthState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
  const code = normalizeEmailCode(String(formData.get("code") ?? ""))

  if (!email) {
    return { step: "email", error: "Start over and enter your email address." }
  }
  if (!code) {
    return {
      step: "code",
      email,
      error: "Enter the code from the email, digits only.",
    }
  }

  // Supabase expires and single-uses the code, but nothing upstream slows a
  // guessing loop aimed at one address. Ten tries per window is generous for
  // typos and useless for brute force against a million combinations.
  const rl = await rateLimit(email, {
    prefix: "email-code-verify",
    limit: 10,
    windowSeconds: 900,
  })
  if (!rl.ok) {
    return {
      step: "code",
      email,
      error: "Too many attempts. Request a new code and try again in a few minutes.",
    }
  }

  // Verified on the cookie-bound client so the session cookies land on this
  // browser (same reason the impersonation flow does it this way).
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  })

  if (error || !data.user) {
    return {
      step: "code",
      email,
      error:
        "That code didn't match or has expired. Check the newest email, or request a new code.",
    }
  }

  // Match the auth-callback rule: an authed user with no current org hasn't
  // finished onboarding.
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", data.user.id)
    .maybeSingle()

  redirect(profile?.current_organization_id ? "/home" : "/onboarding")
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
