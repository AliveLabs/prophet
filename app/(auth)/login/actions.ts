"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { sendEmail } from "@/lib/email/send"
import { MagicLinkEmail } from "@/lib/email/templates/magic-link"

function getRedirectUrl() {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback`
}

function safeRedirectPath(input: string | null) {
  if (!input) {
    return "/login"
  }
  if (input.startsWith("/") && !input.startsWith("//")) {
    return input
  }
  return "/login"
}

export async function sendMagicLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim()
  const redirectPath = safeRedirectPath(
    String(formData.get("redirect_to") ?? "/login")
  )

  if (!email) {
    redirect(`${redirectPath}?error=Missing%20email`)
  }

  const supabase = createAdminSupabaseClient()
  const redirectTo = getRedirectUrl()

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  })

  if (error || !data?.properties?.action_link) {
    const msg = error?.message ?? "Could not generate sign-in link"
    redirect(`${redirectPath}?error=${encodeURIComponent(msg)}`)
  }

  const result = await sendEmail({
    to: email,
    subject: "Sign in to Vatic",
    react: MagicLinkEmail({ email, magicLinkUrl: data.properties.action_link }),
  })

  if (!result.ok) {
    redirect(
      `${redirectPath}?error=${encodeURIComponent("Failed to send magic link email. Please try again.")}`
    )
  }

  redirect(`${redirectPath}?sent=1`)
}

export async function signInWithGoogleAction() {
  const redirectUrl = getRedirectUrl()

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
