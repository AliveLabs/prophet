import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const cookieStore = await cookies()
  const supabase = getSupabaseClient(cookieStore)

  if (code) {
    await supabase.auth.exchangeCodeForSession(code)
  }

  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) {
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
