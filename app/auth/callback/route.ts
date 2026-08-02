import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import {
  describeAuthLinkError,
  readAuthLinkErrorFromSearch,
  INVALID_LINK_MESSAGE,
} from "@/lib/auth/link-errors"

function getSupabaseClient(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value
        },
        set(name, value, options) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name, options) {
          cookieStore.set({ name, value: "", ...options })
        },
      },
    }
  )
}

function loginWithError(request: Request, message: string) {
  const url = new URL("/login", request.url)
  url.searchParams.set("error", message)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const cookieStore = await cookies()
  const supabase = getSupabaseClient(cookieStore)

  // Supabase redirects a REJECTED link here with error params and no `code`.
  // Answer it explicitly — falling through to the "no session" branch below sent
  // the operator to a blank login page with no idea why their link failed.
  const linkError = readAuthLinkErrorFromSearch(searchParams)
  if (linkError) {
    return loginWithError(request, linkError)
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return loginWithError(
        request,
        describeAuthLinkError({ errorCode: error.code, errorDescription: error.message }) ??
          INVALID_LINK_MESSAGE
      )
    }
  }

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
    // No code, no error params, no session — someone reached the callback
    // directly. Nothing to explain; send them to sign in.
    return NextResponse.redirect(new URL("/login", request.url))
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", userData.user.id)
    .maybeSingle()

  const redirectPath = profile?.current_organization_id ? "/home" : "/onboarding"
  return NextResponse.redirect(new URL(redirectPath, request.url))
}
