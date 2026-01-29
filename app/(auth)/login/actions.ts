"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"

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

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: getRedirectUrl(),
    },
  })

  if (error) {
    redirect(`${redirectPath}?error=${encodeURIComponent(error.message)}`)
  }

  redirect(`${redirectPath}?sent=1`)
}

export async function signInWithGoogleAction() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getRedirectUrl(),
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
